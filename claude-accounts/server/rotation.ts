import type { AgentTimelineItem, JsonValue } from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { DEFAULT_ACCOUNT_ID, SWITCH_ROW_KIND, type SwitchRow } from "../shared/accounts";
import { isUsageLimit, resetTime } from "./limits";
import {
  configDirFor,
  isSignedIn,
  labelOf,
  limitedUntil,
  linkSharedEntries,
  readState,
  updateState,
  type State,
} from "./store";

const CLAUDE_PROVIDER = "claude";
const METADATA_KEY = "claude-accounts.account";

/** Account each agent's current session was opened with. */
const sessionAccounts = new Map<string, string>();
/** Consecutive limit switches per agent, reset by a turn that completes normally. */
const switchCounts = new Map<string, number>();

function isClaude(provider: string): boolean {
  return provider === CLAUDE_PROVIDER || provider.startsWith(`${CLAUDE_PROVIDER}/`);
}

function isAvailable(state: State, id: string, now = Date.now()): boolean {
  return !limitedUntil(state, id, now) && isSignedIn(id);
}

/** The next usable account after `fromId`, in list order, wrapping around. */
function nextAvailable(state: State, fromId: string): string | null {
  const ids = state.accounts.map((account) => account.id);
  const start = Math.max(ids.indexOf(fromId), 0);
  for (let step = 1; step <= ids.length; step += 1) {
    const id = ids[(start + step) % ids.length]!;
    if (id !== fromId && isAvailable(state, id)) return id;
  }
  return null;
}

function earliestReset(state: State): string | null {
  const times = state.accounts
    .map((account) => limitedUntil(state, account.id))
    .filter((until): until is string => until !== null)
    .sort();
  return times[0] ?? null;
}

/** The account a session opening now should use, moving the active account off a limited one. */
async function accountForNewSession(): Promise<string> {
  const state = await readState();
  if (!state.autoSwitch || isAvailable(state, state.activeId)) return state.activeId;
  const next = nextAvailable(state, state.activeId);
  if (!next) return state.activeId;
  await updateState((current) => ({ ...current, activeId: next }));
  console.log(`Active account ${state.activeId} is limited; using ${next}`);
  return next;
}

function accountOfAgent(agentId: string, metadata: Record<string, JsonValue>, state: State): string {
  const stored = metadata[METADATA_KEY];
  return sessionAccounts.get(agentId) ?? (typeof stored === "string" ? stored : state.activeId);
}

/** Text of the turn that just ended: everything after the last user message. */
function turnTexts(items: readonly AgentTimelineItem[]): string[] {
  const texts: string[] = [];
  let assistant = "";
  for (const item of items) {
    if (item.type === "user_message") {
      texts.length = 0;
      assistant = "";
    } else if (item.type === "assistant_message") {
      assistant += item.text;
    } else if (item.type === "error" || item.type === "notification") {
      texts.push(item.message);
    }
  }
  if (assistant) texts.push(assistant);
  return texts;
}

async function findLimitNotice(
  paseo: PaseoApi,
  agentId: string,
  failure: string | null,
): Promise<string | null> {
  if (failure && isUsageLimit(failure)) return failure;
  try {
    const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 12 });
    const items = page.entries.map(({ item }) => item as AgentTimelineItem);
    return turnTexts(items).find(isUsageLimit) ?? null;
  } catch (error) {
    console.error(`Could not read the timeline of ${agentId}`, error);
    return null;
  }
}

async function appendRow(paseo: PaseoApi, agentId: string, data: SwitchRow): Promise<void> {
  try {
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: `switch-${Date.now()}`,
      kind: SWITCH_ROW_KIND,
      version: 1,
      data,
    });
  } catch (error) {
    console.error(`Could not add a switch row to ${agentId}`, error);
  }
}

/**
 * Reopens idle Claude agents that are not on the active account, so their next prompt runs on it
 * instead of failing first. Running agents are left alone; they switch if they hit the limit.
 */
export async function reloadIdleAgents(
  paseo: PaseoApi,
  options: { except?: string } = {},
): Promise<number> {
  const state = await readState();
  let reloaded = 0;
  let entries;
  try {
    ({ entries } = await paseo.agents.list());
  } catch (error) {
    console.error("Could not list agents", error);
    return 0;
  }
  for (const { agent } of entries) {
    if (agent.id === options.except || !isClaude(agent.provider)) continue;
    if (agent.status !== "idle" || agent.archivedAt) continue;
    const current = sessionAccounts.get(agent.id);
    // Unknown means the session has not opened since the plugin started; it picks the active
    // account up when it does.
    if (!current || current === state.activeId) continue;
    try {
      await paseo.agents.ref(agent.id).reload();
      reloaded += 1;
    } catch (error) {
      console.error(`Could not reload ${agent.id}`, error);
    }
  }
  return reloaded;
}

let queue: Promise<void> = Promise.resolve();
/** Limit handling reads and moves the active account; one agent at a time keeps that coherent. */
function serialized(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task);
  queue = run.catch((error) => console.error("Limit handling failed", error));
  return run;
}

export function contributeRotation(server: PluginServerContext): () => void {
  const removeOpen = server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    if (!isClaude(request.provider) || request.purpose !== "interactive") return request;
    const accountId = await accountForNewSession();
    linkSharedEntries(accountId);
    sessionAccounts.set(request.agentId, accountId);
    if (request.metadata[METADATA_KEY] !== accountId) {
      // Never await a write to the agent being opened: the open waits for this hook.
      void paseo.agents
        .ref(request.agentId)
        .setMetadata({ [METADATA_KEY]: accountId })
        .catch(() => undefined);
    }
    // The default login runs exactly as without the plugin. Setting CLAUDE_CONFIG_DIR, even to
    // ~/.claude, moves Claude Code's global config and Keychain entry and signs it out.
    if (accountId === DEFAULT_ACCOUNT_ID) return request;
    return {
      ...request,
      env: { ...request.env, CLAUDE_CONFIG_DIR: configDirFor(accountId) },
    };
  });

  const removeTurn = server.addHook("agent.turn.after", async (event, { paseo }) => {
    const { agent, outcome } = event;
    if (!isClaude(agent.provider) || outcome.kind === "canceled") return;
    const failure = outcome.kind === "failed" ? outcome.error.message : null;
    const notice = await findLimitNotice(paseo, agent.id, failure);
    if (!notice) {
      if (outcome.kind === "completed") switchCounts.delete(agent.id);
      return;
    }

    await serialized(async () => {
      const before = await readState();
      const limitedId = accountOfAgent(agent.id, agent.metadata, before);
      const resetsAt = resetTime(notice).toISOString();
      const state = await updateState((current) => ({
        ...current,
        limitedUntil: { ...current.limitedUntil, [limitedId]: resetsAt },
      }));
      const from = labelOf(state, limitedId);
      console.log(`Account ${limitedId} hit its usage limit until ${resetsAt} (agent ${agent.id})`);

      if (!state.autoSwitch) {
        await appendRow(paseo, agent.id, {
          status: "disabled",
          from,
          to: null,
          resetsAt,
          nextAvailableAt: null,
        });
        return;
      }

      const count = (switchCounts.get(agent.id) ?? 0) + 1;
      // Another agent may already have moved the active account to a working one.
      const target =
        state.activeId !== limitedId && isAvailable(state, state.activeId)
          ? state.activeId
          : nextAvailable(state, limitedId);
      if (!target || count > state.accounts.length) {
        switchCounts.delete(agent.id);
        await appendRow(paseo, agent.id, {
          status: "exhausted",
          from,
          to: null,
          resetsAt,
          nextAvailableAt: earliestReset(state),
        });
        return;
      }

      switchCounts.set(agent.id, count);
      const next = await updateState((current) => ({ ...current, activeId: target }));
      await appendRow(paseo, agent.id, {
        status: "switched",
        from,
        to: labelOf(next, target),
        resetsAt,
        nextAvailableAt: null,
      });
      const handle = paseo.agents.ref(agent.id);
      // Reopening reruns agent.open.before, which hands the session the new account. The
      // conversation history is shared between accounts, so the session resumes in place.
      await handle.reload();
      await handle.send(state.resumePrompt);
      void reloadIdleAgents(paseo, { except: agent.id });
    });
  });

  const removeClose = server.addHook("agent.close.after", async ({ agent }) => {
    sessionAccounts.delete(agent.id);
    switchCounts.delete(agent.id);
  });

  return () => {
    removeOpen();
    removeTurn();
    removeClose();
  };
}
