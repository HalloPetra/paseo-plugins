import { randomBytes } from "node:crypto";
import { mkdirSync, promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MessageKind } from "../shared/envelope";

export interface StoredMessage {
  id: string;
  threadId: string;
  kind: MessageKind;
  fromAgentId: string;
  fromLabel: string;
  toAgentId: string;
  toLabel: string;
  body: string;
  expectsReply: boolean;
  /** Send the receiver's final message back to the sender when the turn handling this ends. */
  reportBack: boolean;
  createdAt: string;
  /** Set once the message reached the receiver's prompt. */
  deliveredAt: string | null;
  /** Set once the turn that handled a delivered message ended and follow-ups ran. */
  settledAt: string | null;
  /** Why the message will never be delivered. */
  dropped: string | null;
}

export interface StoredThread {
  id: string;
  /** The two agents in the conversation. */
  agents: [string, string];
  /** Messages exchanged; caps runaway back-and-forth. */
  hops: number;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  threads: StoredThread[];
  messages: StoredMessage[];
}

/** Older delivered messages beyond this are pruned so the file stays small. */
const MAX_MESSAGES = 5000;

const paseoHome = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
export const storePath = join(paseoHome, "orchestrator", "messages.json");

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function load(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as StoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.threads) && Array.isArray(parsed.messages)) {
      return parsed;
    }
  } catch {
    // Missing or unreadable: start empty.
  }
  return { version: 1, threads: [], messages: [] };
}

let data = load();
let writing: Promise<void> = Promise.resolve();
let dirty = false;

function persist(): void {
  if (dirty) return;
  dirty = true;
  writing = writing.then(async () => {
    dirty = false;
    prune();
    mkdirSync(dirname(storePath), { recursive: true });
    const temp = `${storePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data));
    await fs.rename(temp, storePath);
  }).catch((error) => {
    console.error("[orchestrator] Saving messages failed", error);
  });
}

function prune(): void {
  const excess = data.messages.length - MAX_MESSAGES;
  if (excess <= 0) return;
  let removed = 0;
  data.messages = data.messages.filter((message) => {
    if (removed >= excess) return true;
    const finished = message.dropped !== null || (message.deliveredAt !== null && message.settledAt !== null);
    if (!finished) return true;
    removed += 1;
    return false;
  });
  const live = new Set(data.messages.map((message) => message.threadId));
  data.threads = data.threads.filter((thread) => live.has(thread.id));
}

export function flushStore(): Promise<void> {
  return writing;
}

export function getThread(id: string): StoredThread | undefined {
  return data.threads.find((thread) => thread.id === id);
}

export function createThread(a: string, b: string, id = newId("t")): StoredThread {
  const now = new Date().toISOString();
  const thread: StoredThread = { id, agents: [a, b], hops: 0, createdAt: now, updatedAt: now };
  data.threads.push(thread);
  persist();
  return thread;
}

export function addMessage(
  input: Omit<StoredMessage, "id" | "createdAt" | "deliveredAt" | "settledAt" | "dropped">,
): StoredMessage {
  const now = new Date().toISOString();
  const message: StoredMessage = {
    ...input,
    id: newId("m"),
    createdAt: now,
    deliveredAt: null,
    settledAt: null,
    dropped: null,
  };
  data.messages.push(message);
  const thread = getThread(input.threadId);
  if (thread) {
    thread.hops += 1;
    thread.updatedAt = now;
  }
  persist();
  return message;
}

export function updateMessages(
  ids: string[],
  patch: Partial<Pick<StoredMessage, "deliveredAt" | "settledAt" | "dropped">>,
): void {
  const wanted = new Set(ids);
  for (const message of data.messages) {
    if (wanted.has(message.id)) Object.assign(message, patch);
  }
  persist();
}

/** Messages still waiting to reach the agent, oldest first. */
export function undeliveredFor(agentId: string): StoredMessage[] {
  return data.messages.filter(
    (message) => message.toAgentId === agentId && message.deliveredAt === null && message.dropped === null,
  );
}

/** Delivered messages whose handling turn has not ended yet. */
export function unsettledFor(agentId: string): StoredMessage[] {
  return data.messages.filter(
    (message) => message.toAgentId === agentId && message.deliveredAt !== null && message.settledAt === null,
  );
}

export function agentsWithUndelivered(): string[] {
  const ids = new Set<string>();
  for (const message of data.messages) {
    if (message.deliveredAt === null && message.dropped === null) ids.add(message.toAgentId);
  }
  return [...ids];
}

export function agentsWithUnsettled(): string[] {
  const ids = new Set<string>();
  for (const message of data.messages) {
    if (message.deliveredAt !== null && message.settledAt === null) ids.add(message.toAgentId);
  }
  return [...ids];
}

export function threadMessages(threadId: string): StoredMessage[] {
  return data.messages.filter((message) => message.threadId === threadId);
}

export function threadsFor(agentId: string): StoredThread[] {
  return data.threads
    .filter((thread) => thread.agents.includes(agentId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Whether `fromAgentId` posted to the thread after `since`. */
export function repliedSince(threadId: string, fromAgentId: string, since: string): boolean {
  return data.messages.some(
    (message) => message.threadId === threadId && message.fromAgentId === fromAgentId && message.createdAt >= since,
  );
}

export function receivedBy(agentId: string, limit: number): StoredMessage[] {
  return data.messages.filter((message) => message.toAgentId === agentId).slice(-limit);
}
