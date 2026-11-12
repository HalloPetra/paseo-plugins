import { execFile } from "node:child_process";
import type { PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type { ArchiveEntry, Rules, rulesSettings, watcherStatusRpc } from "../shared/rules";

type Reason = ArchiveEntry["reason"];

interface Pending {
  reason: Reason;
  name: string;
  dueAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const RETRY_AFTER_FAILURE_MS = 15 * 60_000;
const RECENT_LIMIT = 25;

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
}

/** Why a workspace should be archived under the current rules, or null to leave it. */
function verdict(workspace: PaseoWorkspace, rules: Rules): Reason | null {
  if (workspace.archivingAt || workspace.internal || workspace.background) return null;
  if (rules.skipPinned && workspace.pinnedAt) return null;
  // Only Paseo-made worktrees; archiving a directory or the main checkout is never what the user meant.
  if (workspace.workspaceKind !== "worktree" && workspace.workspaceKind !== "checkout") return null;
  // An agent is still busy or waiting on the user; re-evaluated when the status changes.
  if (workspace.status === "running" || workspace.status === "needs_input") return null;
  const pr = workspace.githubRuntime?.pullRequest;
  if (!pr) return null;
  if (pr.isMerged) return rules.archiveOnMerge ? "merged" : null;
  if (pr.state.toUpperCase() === "CLOSED") return rules.archiveOnClose ? "closed" : null;
  return null;
}

/** Uncommitted changes, or commits that exist on no remote, would be lost with the worktree. */
async function unsavedWork(directory: string): Promise<string | null> {
  const status = await git(["status", "--porcelain"], directory);
  if (status.trim()) return "uncommitted changes";
  const unpushed = Number((await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], directory)).trim());
  if (unpushed > 0) return `${unpushed} unpushed commit${unpushed === 1 ? "" : "s"}`;
  return null;
}

export function createWatcher(settings: PluginSettings<typeof rulesSettings.schema>) {
  let paseo: PaseoApi | null = null;
  let release: (() => Promise<void>) | null = null;
  let stopped = false;
  let rules: Rules | null = null;
  const workspaces = new Map<string, PaseoWorkspace>();
  const pending = new Map<string, Pending>();
  /** Workspaces skipped or failed, keyed by id, with the time they may be tried again. */
  const holdUntil = new Map<string, number>();
  const handled = new Set<string>();
  const recent: ArchiveEntry[] = [];

  const loadRules = async () => {
    const state = await settings.read();
    rules = state.status === "ready" ? state.values : null;
    if (state.status === "invalid") console.error("[auto-sort] settings invalid:", state.error);
  };

  const record = (entry: ArchiveEntry) => {
    recent.unshift(entry);
    recent.length = Math.min(recent.length, RECENT_LIMIT);
  };

  const cancel = (id: string) => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
  };

  async function fire(id: string) {
    pending.delete(id);
    const workspace = workspaces.get(id);
    if (!workspace || !paseo || !rules || stopped) return;
    const reason = verdict(workspace, rules);
    if (!reason || handled.has(id)) return;
    const pr = workspace.githubRuntime?.pullRequest;
    const base = {
      workspaceId: id,
      name: workspace.title || workspace.name,
      project: workspace.projectCustomName || workspace.projectDisplayName,
      reason,
      prNumber: pr?.number ?? null,
      at: new Date().toISOString(),
    };
    try {
      if (rules.keepUnsavedWork) {
        const unsaved = await unsavedWork(workspace.workspaceDirectory);
        if (unsaved) {
          console.log(`[auto-sort] keeping ${base.name}: ${unsaved}`);
          holdUntil.set(id, Date.now() + RETRY_AFTER_FAILURE_MS);
          record({ ...base, error: `Kept: ${unsaved}` });
          return;
        }
      }
      handled.add(id);
      await paseo.workspaces.archive(id);
      console.log(`[auto-sort] archived ${base.name} (PR ${reason})`);
      record({ ...base, error: null });
    } catch (error) {
      handled.delete(id);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[auto-sort] archiving ${base.name} failed:`, message);
      holdUntil.set(id, Date.now() + RETRY_AFTER_FAILURE_MS);
      record({ ...base, error: message });
    }
  }

  function evaluate(workspace: PaseoWorkspace) {
    const id = workspace.id;
    const reason = rules ? verdict(workspace, rules) : null;
    if (!reason || handled.has(id)) {
      cancel(id);
      return;
    }
    const existing = pending.get(id);
    if (existing && existing.reason === reason) return;
    cancel(id);
    const hold = holdUntil.get(id) ?? 0;
    const delay = Math.max(Number(rules!.delayMinutes) * 60_000, hold - Date.now(), 0);
    console.log(`[auto-sort] ${workspace.title || workspace.name}: PR ${reason}, archiving in ${Math.round(delay / 60_000)} min`);
    pending.set(id, {
      reason,
      name: workspace.title || workspace.name,
      dueAt: Date.now() + delay,
      timer: setTimeout(() => void fire(id), delay),
    });
  }

  const evaluateAll = () => {
    for (const workspace of workspaces.values()) evaluate(workspace);
  };

  async function start(api: PaseoApi) {
    paseo = api;
    await loadRules();
    const result = await api.workspaces.list({ subscribe: {}, page: { limit: 200 } });
    if (stopped) {
      void result.subscription.release();
      return;
    }
    const unsubscribe = result.subscription.subscribe({
      snapshot: (snapshot) => {
        workspaces.clear();
        for (const workspace of snapshot.entries) workspaces.set(workspace.id, workspace);
        for (const id of [...pending.keys()]) if (!workspaces.has(id)) cancel(id);
        evaluateAll();
        void fetchRemaining(api, snapshot.pageInfo.hasMore ? snapshot.pageInfo.nextCursor : null);
      },
      update: (message) => {
        if (message.type !== "workspace_update") return;
        const update = message.payload;
        if (update.kind === "upsert") {
          workspaces.set(update.workspace.id, update.workspace);
          evaluate(update.workspace);
        } else {
          workspaces.delete(update.id);
          cancel(update.id);
        }
      },
      error: (error) => {
        console.error("[auto-sort] workspace subscription failed:", error);
        void stopWatching();
      },
    });
    release = async () => {
      unsubscribe();
      await result.subscription.release();
    };
    console.log("[auto-sort] watching workspaces");
  }

  async function fetchRemaining(api: PaseoApi, cursor: string | null) {
    try {
      while (cursor && !stopped) {
        const page = await api.workspaces.list({ page: { limit: 200, cursor } });
        for (const workspace of page.entries) {
          if (workspaces.has(workspace.id)) continue;
          workspaces.set(workspace.id, workspace);
          evaluate(workspace);
        }
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
      }
    } catch (error) {
      console.error("[auto-sort] paging workspaces failed:", error);
    }
  }

  async function stopWatching() {
    const releasing = release;
    release = null;
    starting = null;
    for (const id of [...pending.keys()]) cancel(id);
    await releasing?.().catch(() => {});
  }

  let starting: Promise<void> | null = null;

  /**
   * The daemon hands plugins a Paseo client only inside handlers and hooks, so the watcher starts
   * on the first one to arrive: an app connecting, or any agent or workspace lifecycle event.
   */
  function ensure(api: PaseoApi): Promise<void> {
    if (stopped) return Promise.resolve();
    starting ??= start(api).catch((error) => {
      console.error("[auto-sort] starting watcher failed:", error);
      starting = null;
    });
    return starting;
  }

  const unsubscribeSettings = settings.subscribe((state) => {
    if (state.status !== "ready") return;
    rules = state.values;
    holdUntil.clear();
    for (const id of [...pending.keys()]) cancel(id);
    evaluateAll();
  });

  return {
    ensure,
    status(): RpcOutput<typeof watcherStatusRpc> {
      return {
        watching: release !== null,
        workspaces: workspaces.size,
        pending: [...pending.entries()]
          .map(([workspaceId, entry]) => ({
            workspaceId,
            name: entry.name,
            reason: entry.reason,
            dueAt: new Date(entry.dueAt).toISOString(),
          }))
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
        recent: [...recent],
      };
    },
    async stop() {
      stopped = true;
      unsubscribeSettings();
      await stopWatching();
    },
  };
}
