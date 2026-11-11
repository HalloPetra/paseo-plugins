import type { PaseoApi } from "@getpaseo/client";
import type { Activity, KeepAwakeSettings, Status } from "../shared/keep-awake";
import { SleepBlocker, SUPPORTED } from "./blocker";

const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

interface AgentState {
  title: string;
  workspaceId: string | null;
  status: string;
  /** Started by another agent, or a helper hidden from the tab list. */
  child: boolean;
  backgroundCount: number;
}

interface AgentLike {
  id: string;
  title?: string | null;
  workspaceId?: string | null;
  status: string;
  labels?: Record<string, string>;
  background?: boolean;
  internal?: boolean;
  archivedAt?: string | null;
  backgroundWork?: { count: number };
}

function toState(agent: AgentLike): AgentState {
  const parent = agent.labels?.[PARENT_AGENT_ID_LABEL]?.trim();
  return {
    title: agent.title?.trim() || "Untitled agent",
    workspaceId: agent.workspaceId ?? null,
    status: agent.status,
    child: Boolean(parent) || agent.background === true,
    backgroundCount: agent.backgroundWork?.count ?? 0,
  };
}

/**
 * Watches every agent on the daemon and holds a sleep assertion while any of them is working.
 * The plugin process has no SDK of its own at startup; the first hook or subscription that
 * hands one over starts the watch.
 */
export class Tracker {
  private readonly agents = new Map<string, AgentState>();
  private readonly blocker = new SleepBlocker(() => this.emit());
  private readonly listeners = new Set<(status: Status) => void>();
  private readonly lifetime = new AbortController();
  private settings: KeepAwakeSettings | null = null;
  private watching = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseAt: number | null = null;
  private lastEmitted = "";

  attach(paseo: PaseoApi): void {
    if (this.watching || this.lifetime.signal.aborted) return;
    this.watching = true;
    void this.watch(paseo);
  }

  private async watch(paseo: PaseoApi): Promise<void> {
    try {
      const { subscription } = await paseo.agents.list({
        subscribe: {},
        includeBackground: true,
        // Closed agents cannot be working. A closed agent that starts a turn arrives as an upsert,
        // and the turn hook marks it running before that.
        filter: { includeBackground: true, statuses: ["initializing", "idle", "running", "error"] },
        page: { limit: 200 },
        signal: this.lifetime.signal,
      });
      subscription.subscribe({
        snapshot: ({ entries }) => {
          this.agents.clear();
          for (const { agent } of entries) this.upsert(agent);
          this.evaluate();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") this.upsert(update.agent);
          else this.agents.delete(update.agentId);
          this.evaluate();
        },
        error: (error) => {
          console.error("Agent watch failed", error);
          this.watching = false;
        },
      });
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      console.error("Could not watch agents", error);
      this.watching = false;
    }
  }

  private upsert(agent: AgentLike): void {
    if (agent.internal || agent.archivedAt) {
      this.agents.delete(agent.id);
      return;
    }
    this.agents.set(agent.id, toState(agent));
  }

  /** Hooks fire before the list update arrives; apply them at once so a turn never starts asleep. */
  turnStarted(agent: {
    id: string;
    title: string | null;
    workspaceId: string | null;
    parentAgentId: string | null;
    background?: boolean;
  }): void {
    const known = this.agents.get(agent.id);
    this.agents.set(agent.id, {
      title: agent.title?.trim() || known?.title || "Untitled agent",
      workspaceId: agent.workspaceId ?? known?.workspaceId ?? null,
      status: "running",
      child: Boolean(agent.parentAgentId) || agent.background === true,
      backgroundCount: known?.backgroundCount ?? 0,
    });
    this.evaluate();
  }

  agentGone(agentId: string): void {
    if (this.agents.delete(agentId)) this.evaluate();
  }

  setSettings(settings: KeepAwakeSettings): void {
    this.settings = settings;
    this.evaluate();
  }

  activity(): Activity[] {
    const settings = this.settings;
    if (!settings) return [];
    const result: Activity[] = [];
    for (const [agentId, agent] of this.agents) {
      if (agent.child && !settings.includeChildAgents) continue;
      if (agent.status === "running") {
        result.push({
          agentId,
          title: agent.title,
          workspaceId: agent.workspaceId,
          kind: agent.child ? "child" : "agent",
          count: 0,
        });
      } else if (settings.includeBackgroundWork && agent.backgroundCount > 0 && agent.status !== "closed") {
        result.push({
          agentId,
          title: agent.title,
          workspaceId: agent.workspaceId,
          kind: "background",
          count: agent.backgroundCount,
        });
      }
    }
    return result;
  }

  private evaluate(): void {
    const settings = this.settings;
    if (!settings || !settings.enabled || !SUPPORTED) {
      this.clearGrace();
      this.blocker.release();
      this.emit();
      return;
    }
    if (this.activity().length > 0) {
      this.clearGrace();
      this.blocker.hold({ display: settings.keepDisplayAwake, system: settings.blockSystemSleep });
      this.emit();
      return;
    }
    if (!this.blocker.holding || this.graceTimer) {
      this.emit();
      return;
    }
    if (settings.graceSeconds <= 0) {
      this.blocker.release();
      return;
    }
    this.releaseAt = Date.now() + settings.graceSeconds * 1000;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.releaseAt = null;
      this.blocker.release();
    }, settings.graceSeconds * 1000);
    this.emit();
  }

  releaseNow(): void {
    if (this.activity().length > 0) return;
    this.clearGrace();
    this.blocker.release();
    this.emit();
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.releaseAt = null;
  }

  status(): Status {
    return {
      platform: process.platform,
      supported: SUPPORTED,
      enabled: this.settings?.enabled ?? false,
      holding: this.blocker.holding,
      releaseInMs: this.releaseAt === null ? null : Math.max(0, this.releaseAt - Date.now()),
      error: this.blocker.error,
      activity: this.activity(),
    };
  }

  subscribe(listener: (status: Status) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.status();
    // Most agent updates (titles, usage, timestamps) change nothing shown here.
    const json = JSON.stringify({ ...status, releaseInMs: this.releaseAt });
    if (json === this.lastEmitted) return;
    this.lastEmitted = json;
    for (const listener of this.listeners) listener(status);
  }

  stop(): void {
    this.lifetime.abort();
    this.clearGrace();
    this.blocker.release();
    this.listeners.clear();
  }
}
