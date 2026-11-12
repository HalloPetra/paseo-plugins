import type { PaseoApi } from "@getpaseo/client";
import { formatBatch, type MessageKind } from "../shared/envelope";
import {
  addMessage,
  agentsWithUndelivered,
  agentsWithUnsettled,
  createThread,
  getThread,
  repliedSince,
  type StoredMessage,
  type StoredThread,
  undeliveredFor,
  unsettledFor,
  updateMessages,
} from "./store";

/** Messages in one thread before it stops waking agents; stops accidental endless back-and-forth. */
export const MAX_THREAD_HOPS = 40;
/** Longest final message passed back in a report or an ask fallback. */
const MAX_REPORT_CHARS = 12_000;
const BUSY_STATUSES = new Set(["running", "initializing"]);
const MAX_SEND_FAILURES = 5;
/** A delivered message whose turn end was missed (plugin reload, dropped event) settles after this. */
const STALE_SETTLE_MS = 3 * 60_000;

let paseoApi: PaseoApi | null = null;

export function rememberPaseo(paseo: PaseoApi): void {
  paseoApi = paseo;
}

// ---------------------------------------------------------------------------
// Sending

export interface SendInput {
  fromAgentId: string;
  fromLabel: string;
  toAgentId: string;
  toLabel: string;
  kind: MessageKind;
  body: string;
  threadId?: string;
  expectsReply: boolean;
  reportBack: boolean;
}

function threadFor(input: SendInput): StoredThread {
  if (!input.threadId) return createThread(input.fromAgentId, input.toAgentId);
  const thread = getThread(input.threadId);
  if (!thread) throw new Error(`Unknown thread ${input.threadId}.`);
  if (!thread.agents.includes(input.fromAgentId) || !thread.agents.includes(input.toAgentId)) {
    throw new Error(`Thread ${input.threadId} is not between these two agents. Leave thread_id out to start a new one.`);
  }
  return thread;
}

/** Stores a message and delivers it now if the receiver is idle, otherwise when its turn ends. */
export async function sendMessage(paseo: PaseoApi, input: SendInput): Promise<StoredMessage> {
  if (input.fromAgentId === input.toAgentId) throw new Error("An agent cannot message itself.");
  const thread = threadFor(input);
  if (thread.hops >= MAX_THREAD_HOPS) {
    throw new Error(
      `Thread ${thread.id} reached ${MAX_THREAD_HOPS} messages, so it no longer wakes agents. ` +
        "If the conversation should continue, start a new thread with orchestrator_send.",
    );
  }
  const message = addMessage({
    threadId: thread.id,
    kind: input.kind,
    fromAgentId: input.fromAgentId,
    fromLabel: input.fromLabel,
    toAgentId: input.toAgentId,
    toLabel: input.toLabel,
    body: input.body,
    expectsReply: input.expectsReply,
    reportBack: input.reportBack,
  });
  await flush(paseo, input.toAgentId);
  return message;
}

// ---------------------------------------------------------------------------
// Delivery

const flushing = new Set<string>();
const sendFailures = new Map<string, number>();
/** Delivers every waiting message to an agent in one prompt, once the agent is not busy. */
export async function flush(paseo: PaseoApi, agentId: string): Promise<void> {
  if (flushing.has(agentId)) return;
  flushing.add(agentId);
  try {
    const pending = undeliveredFor(agentId);
    if (pending.length === 0) return;
    const agent = paseo.agents.ref(agentId);
    const snapshot = await agent.refresh();
    if (!snapshot) {
      updateMessages(pending.map((message) => message.id), { dropped: "The receiving agent no longer exists." });
      return;
    }
    if (snapshot.agent.archivedAt) {
      updateMessages(pending.map((message) => message.id), { dropped: "The receiving agent was archived." });
      return;
    }
    if (BUSY_STATUSES.has(snapshot.agent.status)) return;

    const text = formatBatch(
      pending.map((message) => ({
        kind: message.kind,
        threadId: message.threadId,
        from: message.fromLabel,
        fromAgentId: message.fromAgentId,
        expectsReply: message.expectsReply,
        body: message.body,
      })),
    );
    try {
      // Steer rather than interrupt: if someone started a turn since the status check, the
      // message joins it instead of killing it. Providers that cannot steer interrupt anyway.
      await agent.send(text, { activeTurnBehavior: "steer" });
      sendFailures.delete(agentId);
      updateMessages(pending.map((message) => message.id), { deliveredAt: new Date().toISOString() });
    } catch (error) {
      const failures = (sendFailures.get(agentId) ?? 0) + 1;
      sendFailures.set(agentId, failures);
      console.error(`[orchestrator] Delivering to ${agentId} failed (${failures})`, error);
      if (failures >= MAX_SEND_FAILURES) {
        sendFailures.delete(agentId);
        const reason = error instanceof Error ? error.message : String(error);
        updateMessages(pending.map((message) => message.id), { dropped: `Delivery failed: ${reason}` });
      }
    }
  } catch (error) {
    console.error(`[orchestrator] Checking ${agentId} failed`, error);
  } finally {
    flushing.delete(agentId);
  }
}

// ---------------------------------------------------------------------------
// Questions waiting for an answer

export type Answer =
  | { kind: "reply"; body: string }
  | { kind: "final"; body: string | null; outcome: string };

interface Waiter {
  questionId: string;
  recipientAgentId: string;
  resolve(answer: Answer): void;
}

const waiters = new Map<string, Waiter>();

/** Resolves with the answer, or null when the timeout passes or the call is canceled. */
export function waitForAnswer(
  question: StoredMessage,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Answer | null> {
  return new Promise((resolve) => {
    const finish = (answer: Answer | null) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (waiters.get(question.threadId)?.questionId === question.id) waiters.delete(question.threadId);
      resolve(answer);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener("abort", onAbort);
    waiters.set(question.threadId, {
      questionId: question.id,
      recipientAgentId: question.toAgentId,
      resolve: finish,
    });
  });
}

/**
 * Hands a reply to a waiting orchestrator_ask in the same thread. Returns false when no one is
 * waiting, in which case the reply goes out as an ordinary message.
 */
export function answerWaiter(threadId: string, fromAgentId: string, body: string): boolean {
  const waiter = waiters.get(threadId);
  if (!waiter || waiter.recipientAgentId !== fromAgentId) return false;
  waiter.resolve({ kind: "reply", body });
  return true;
}

// ---------------------------------------------------------------------------
// Turn ends

function truncate(text: string): string {
  return text.length > MAX_REPORT_CHARS ? `${text.slice(0, MAX_REPORT_CHARS)}\n\n[truncated]` : text;
}

/** The text the agent ended its latest turn with, or null when the turn had none. */
export async function finalMessage(paseo: PaseoApi, agentId: string): Promise<string | null> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 60 });
  const parts: string[] = [];
  for (let index = page.entries.length - 1; index >= 0; index -= 1) {
    const item = page.entries[index]!.item;
    if (item.type === "assistant_message") {
      parts.unshift(item.text);
      continue;
    }
    if (parts.length > 0 || item.type === "user_message") break;
  }
  const text = parts.join("\n").trim();
  return text ? truncate(text) : null;
}

export type TurnOutcome =
  | { kind: "completed" }
  | { kind: "failed"; error: { message: string } }
  | { kind: "canceled"; reason: string };

function describeOutcome(outcome: TurnOutcome): string {
  if (outcome.kind === "completed") return "completed";
  if (outcome.kind === "failed") return `failed: ${outcome.error.message}`;
  return `was stopped (${outcome.reason})`;
}

/**
 * Runs when an agent's turn ends: answers pending orchestrator_ask calls that got no explicit
 * reply, sends requested reports back, then delivers anything that queued meanwhile.
 */
export async function onTurnEnded(paseo: PaseoApi, agentId: string, outcome: TurnOutcome): Promise<void> {
  const unsettled = unsettledFor(agentId);
  if (unsettled.length > 0) {
    let final: string | null | undefined;
    const getFinal = async () => {
      if (final === undefined) final = await finalMessage(paseo, agentId).catch(() => null);
      return final;
    };
    const reportsBySender = new Map<string, StoredMessage>();
    for (const message of unsettled) {
      const answered = repliedSince(message.threadId, agentId, message.deliveredAt!);
      const waiter = waiters.get(message.threadId);
      if (waiter?.questionId === message.id) {
        if (!answered) waiter.resolve({ kind: "final", body: await getFinal(), outcome: describeOutcome(outcome) });
      } else if (message.reportBack && !answered && !reportsBySender.has(message.fromAgentId)) {
        reportsBySender.set(message.fromAgentId, message);
      }
    }
    updateMessages(unsettled.map((message) => message.id), { settledAt: new Date().toISOString() });

    for (const message of reportsBySender.values()) {
      const body = await getFinal();
      const status = describeOutcome(outcome);
      try {
        await sendMessage(paseo, {
          fromAgentId: agentId,
          fromLabel: message.toLabel,
          toAgentId: message.fromAgentId,
          toLabel: message.fromLabel,
          kind: "report",
          threadId: message.threadId,
          body: body ? `Turn ${status}. Final message:\n\n${body}` : `Turn ${status} without a final message.`,
          expectsReply: false,
          reportBack: false,
        });
      } catch (error) {
        console.error("[orchestrator] Sending a report failed", error);
      }
    }
  }
  await flush(paseo, agentId);
}

// ---------------------------------------------------------------------------
// Background sweep

/** Retries waiting deliveries and settles deliveries whose turn end was missed. */
export async function sweep(): Promise<void> {
  const paseo = paseoApi;
  if (!paseo) return;
  for (const agentId of agentsWithUndelivered()) await flush(paseo, agentId);
  await settleStale(paseo, agentsWithUnsettled());
}

async function settleStale(paseo: PaseoApi, agentIds: Iterable<string>): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_SETTLE_MS).toISOString();
  for (const agentId of agentIds) {
    const stale = unsettledFor(agentId).filter((message) => message.deliveredAt! < cutoff);
    if (stale.length === 0) continue;
    const snapshot = await paseo.agents.ref(agentId).refresh().catch(() => null);
    if (!snapshot || BUSY_STATUSES.has(snapshot.agent.status)) continue;
    await onTurnEnded(paseo, agentId, { kind: "completed" });
  }
}
