import type { PaseoApi } from "@getpaseo/client";
import { defineAgentTool, type AgentToolContext, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { formatBatch } from "../shared/envelope";
import {
  agentLabel,
  type Directory,
  type DirectoryAgent,
  loadDirectory,
  primaryAgent,
  resolveTarget,
  type ResolvedTarget,
  workspaceOf,
} from "./directory";
import { answerWaiter, finalMessage, onTurnEnded, rememberPaseo, sendMessage, waitForAnswer } from "./relay";
import {
  addMessage,
  createThread,
  getThread,
  newId,
  receivedBy,
  type StoredMessage,
  threadMessages,
  threadsFor,
  undeliveredFor,
  updateMessages,
} from "./store";

/** Tool calls have a 10 minute ceiling; stay under it so the call returns a useful result. */
const MAX_WAIT_SECONDS = 570;
const POLL_MS = 3000;

function text(value: string) {
  return { text: value };
}

function preview(body: string, max = 160): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function describeAgent(agent: DirectoryAgent, selfId: string): string {
  const parts = [`${agent.id}`, agent.title ? `"${agent.title}"` : "(untitled)", agent.status];
  parts.push(agent.model ? `${agent.provider}/${agent.model}` : agent.provider);
  if (agent.pendingPermissions > 0) parts.push(`${agent.pendingPermissions} permission request(s) pending`);
  const queued = undeliveredFor(agent.id).length;
  if (queued > 0) parts.push(`${queued} message(s) queued for it`);
  if (agent.id === selfId) parts.push("← you");
  return parts.join(" · ");
}

async function setup(context: AgentToolContext): Promise<{ paseo: PaseoApi; directory: Directory; selfLabel: string }> {
  rememberPaseo(context.paseo);
  const directory = await loadDirectory(context.paseo);
  return { paseo: context.paseo, directory, selfLabel: agentLabel(directory, context.agent.id) };
}

function deliveryNote(message: StoredMessage): string {
  if (message.dropped) return `not delivered: ${message.dropped}`;
  if (message.deliveredAt) return "delivered";
  return "queued; it is delivered when the receiver finishes its current turn";
}

// ---------------------------------------------------------------------------

const overview = defineAgentTool({
  name: "orchestrator_overview",
  title: "Orchestrator: overview",
  description:
    "List every Paseo workspace on this host with its agents, their status, and which one is you. " +
    "Use it to find who to message with orchestrator_send or orchestrator_ask. A workspace is addressed by its name or id; " +
    "messages to a workspace go to its oldest live agent.",
  input: z.object({}),
  async execute(_input, context) {
    const { directory } = await setup(context);
    const self = context.agent.id;
    const own = workspaceOf(directory, self);
    const lines = [
      `You are ${agentLabel(directory, self)} (agent ${self}${own ? `, workspace ${own.id}` : ""}).`,
      "",
      `Workspaces (${directory.workspaces.length}):`,
    ];
    for (const workspace of directory.workspaces) {
      const where = workspace.directory ? ` · ${workspace.directory}` : "";
      lines.push(`- "${workspace.name}" · ${workspace.id} · project ${workspace.project} · ${workspace.status}${where}`);
      if (workspace.agents.length === 0) lines.push("    (no live agent)");
      for (const agent of workspace.agents) {
        const marker = agent.id === primaryAgent(workspace)?.id ? "*" : "-";
        lines.push(`    ${marker} ${describeAgent(agent, self)}`);
      }
    }
    if (directory.looseAgents.length > 0) {
      lines.push("", "Agents outside workspaces:");
      for (const agent of directory.looseAgents) lines.push(`  - ${describeAgent(agent, self)}`);
    }
    lines.push("", "* marks the agent that receives messages sent to the workspace.");
    return text(lines.join("\n"));
  },
});

const send = defineAgentTool({
  name: "orchestrator_send",
  title: "Orchestrator: send a message",
  description:
    "Send a message to another workspace or agent without waiting. The receiver gets it as a prompt right away " +
    "when idle, otherwise as soon as its current turn ends. `to` takes workspace names or ids, agent ids, or \"all\" " +
    "for every other workspace. Set report_back to get the receiver's final message sent back to you when it " +
    "finishes handling yours: the way to hand out work and hear back. Pass thread_id to continue a conversation; " +
    "`to` may then be left out.",
  input: z.object({
    to: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional()
      .describe('Workspace name or id, agent id, a list of them, or "all"'),
    message: z.string().min(1).describe("Message text; Markdown is fine"),
    thread_id: z.string().optional().describe("Continue this thread instead of starting a new one"),
    report_back: z
      .boolean()
      .default(false)
      .describe("Send you the receiver's final message once it has handled this"),
    expects_reply: z.boolean().default(false).describe("Ask the receiver to answer with orchestrator_reply"),
  }),
  async execute(input, context) {
    const { paseo, directory, selfLabel } = await setup(context);
    const self = context.agent.id;
    const targets = resolveRecipients(directory, self, input.to, input.thread_id);
    const results: string[] = [];
    for (const target of targets) {
      try {
        const message = await sendMessage(paseo, {
          fromAgentId: self,
          fromLabel: selfLabel,
          toAgentId: target.agentId,
          toLabel: target.label,
          kind: "message",
          body: input.message,
          threadId: input.thread_id,
          expectsReply: input.expects_reply,
          reportBack: input.report_back,
        });
        results.push(`- ${target.label}: thread ${message.threadId}, ${deliveryNote(message)}`);
      } catch (error) {
        results.push(`- ${target.label}: failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const tail = input.report_back
      ? "\n\nReports arrive as new prompts when each receiver finishes. End your turn to receive them, or call orchestrator_wait."
      : "";
    return text(`Sent to ${targets.length} recipient(s):\n${results.join("\n")}${tail}`);
  },
});

function resolveRecipients(
  directory: Directory,
  self: string,
  to: string | string[] | undefined,
  threadId: string | undefined,
): ResolvedTarget[] {
  if (to === undefined) {
    if (!threadId) throw new Error("Give `to`, or a thread_id to continue.");
    const thread = getThread(threadId);
    if (!thread || !thread.agents.includes(self)) throw new Error(`Thread ${threadId} is not one of yours.`);
    const other = thread.agents.find((id) => id !== self)!;
    return [{ agentId: other, label: agentLabel(directory, other) }];
  }
  const list = Array.isArray(to) ? to : [to];
  if (list.length === 1 && list[0]!.trim().toLowerCase() === "all") {
    const own = workspaceOf(directory, self)?.id;
    const targets = directory.workspaces
      .filter((workspace) => workspace.id !== own)
      .map(primaryAgent)
      .filter((agent): agent is DirectoryAgent => agent !== undefined && agent.id !== self)
      .map((agent) => ({ agentId: agent.id, label: agentLabel(directory, agent.id) }));
    if (targets.length === 0) throw new Error("There is no other workspace with a live agent.");
    return targets;
  }
  const seen = new Set<string>();
  return list
    .map((entry) => resolveTarget(directory, entry))
    .filter((target) => (seen.has(target.agentId) ? false : (seen.add(target.agentId), true)));
}

const ask = defineAgentTool({
  name: "orchestrator_ask",
  title: "Orchestrator: ask and wait",
  description:
    "Ask another workspace or agent a question and wait for the answer. The receiver answers with orchestrator_reply; " +
    "if it finishes its turn without doing so, you get its final message instead. If the timeout passes, the " +
    "thread stays open and a later answer arrives as a new prompt. Avoid asking an agent that is itself waiting " +
    "on you: neither can answer until one times out.",
  input: z.object({
    to: z.string().min(1).describe("Workspace name or id, or agent id"),
    question: z.string().min(1),
    thread_id: z.string().optional().describe("Ask within an existing thread"),
    timeout_seconds: z.number().int().min(5).max(MAX_WAIT_SECONDS).default(300),
  }),
  async execute(input, context) {
    const { paseo, directory, selfLabel } = await setup(context);
    const target = resolveTarget(directory, input.to);
    const question = await sendMessage(paseo, {
      fromAgentId: context.agent.id,
      fromLabel: selfLabel,
      toAgentId: target.agentId,
      toLabel: target.label,
      kind: "question",
      body: input.question,
      threadId: input.thread_id,
      expectsReply: true,
      reportBack: false,
    });
    if (question.dropped) return { text: `Could not deliver: ${question.dropped}`, isError: true };
    const answer = await waitForAnswer(question, input.timeout_seconds * 1000, context.signal);
    const header = `Thread ${question.threadId} with ${target.label}.`;
    if (!answer) {
      return text(
        `${header} No answer within ${input.timeout_seconds}s (${deliveryNote(question)}). ` +
          "The thread stays open; a later reply arrives as a new prompt, or check orchestrator_inbox.",
      );
    }
    if (answer.kind === "reply") return text(`${header} Reply:\n\n${answer.body}`);
    return text(
      `${header} They did not call orchestrator_reply; their turn ${answer.outcome}. ` +
        (answer.body ? `Their final message:\n\n${answer.body}` : "They ended without a final message."),
    );
  },
});

const reply = defineAgentTool({
  name: "orchestrator_reply",
  title: "Orchestrator: reply",
  description:
    "Answer a message you received through the orchestrator. Pass the thread id from the message. " +
    "A sender waiting in orchestrator_ask gets the reply immediately; otherwise it arrives as a new prompt.",
  input: z.object({
    thread_id: z.string().min(1),
    message: z.string().min(1),
  }),
  async execute(input, context) {
    const { paseo, directory, selfLabel } = await setup(context);
    const self = context.agent.id;
    const thread = getThread(input.thread_id);
    if (!thread || !thread.agents.includes(self)) {
      return { text: `Thread ${input.thread_id} is not one of yours. Check orchestrator_inbox.`, isError: true };
    }
    const other = thread.agents.find((id) => id !== self)!;
    const otherLabel = agentLabel(directory, other);
    if (answerWaiter(thread.id, self, input.message)) {
      const stored = addMessage({
        threadId: thread.id,
        kind: "reply",
        fromAgentId: self,
        fromLabel: selfLabel,
        toAgentId: other,
        toLabel: otherLabel,
        body: input.message,
        expectsReply: false,
        reportBack: false,
      });
      const now = new Date().toISOString();
      updateMessages([stored.id], { deliveredAt: now, settledAt: now });
      return text(`Replied to ${otherLabel}; they were waiting and have it now.`);
    }
    const message = await sendMessage(paseo, {
      fromAgentId: self,
      fromLabel: selfLabel,
      toAgentId: other,
      toLabel: otherLabel,
      kind: "reply",
      body: input.message,
      threadId: thread.id,
      expectsReply: false,
      reportBack: false,
    });
    return text(`Replied to ${otherLabel}: ${deliveryNote(message)}.`);
  },
});

const inbox = defineAgentTool({
  name: "orchestrator_inbox",
  title: "Orchestrator: inbox",
  description:
    "List your orchestrator conversations, newest first, or read one thread in full with thread_id. " +
    "Every message you received was also delivered to you as a prompt.",
  input: z.object({
    thread_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async execute(input, context) {
    const { directory } = await setup(context);
    const self = context.agent.id;
    if (input.thread_id) {
      const thread = getThread(input.thread_id);
      if (!thread || !thread.agents.includes(self)) {
        return { text: `Thread ${input.thread_id} is not one of yours.`, isError: true };
      }
      const messages = threadMessages(thread.id).slice(-input.limit);
      const lines = messages.map((message) => {
        const who = message.fromAgentId === self ? "you" : message.fromLabel;
        return `[${message.createdAt}] ${who} (${message.kind}, ${deliveryNote(message)}):\n${message.body}`;
      });
      return text(`Thread ${thread.id}, ${thread.hops} message(s):\n\n${lines.join("\n\n")}`);
    }
    const threads = threadsFor(self).slice(0, input.limit);
    if (threads.length === 0) {
      const received = receivedBy(self, 1).length;
      return text(received ? "No open threads." : "No orchestrator messages yet.");
    }
    const lines = threads.map((thread) => {
      const other = thread.agents.find((id) => id !== self)!;
      const last = threadMessages(thread.id).at(-1);
      const awaiting = last && last.toAgentId === self && last.expectsReply ? " · waiting for your reply" : "";
      const lastLine = last
        ? `${last.fromAgentId === self ? "you" : last.fromLabel}: ${preview(last.body)}`
        : "(empty)";
      return `- ${thread.id} with ${agentLabel(directory, other)} · ${thread.hops} message(s)${awaiting}\n    ${lastLine}`;
    });
    return text(lines.join("\n"));
  },
});

const wait = defineAgentTool({
  name: "orchestrator_wait",
  title: "Orchestrator: wait for workspaces",
  description:
    "Wait until the given workspaces or agents stop working (idle, failed, or waiting on a permission request), " +
    "then return each one's status and final message. mode \"any\" returns as soon as one stops. Use it to " +
    "collect results after handing out work, instead of polling.",
  input: z.object({
    targets: z.array(z.string().min(1)).min(1).describe("Workspace names or ids, or agent ids"),
    mode: z.enum(["all", "any"]).default("all"),
    timeout_seconds: z.number().int().min(5).max(MAX_WAIT_SECONDS).default(300),
  }),
  async execute(input, context) {
    const { paseo, directory } = await setup(context);
    const targets = input.targets.map((target) => resolveTarget(directory, target));
    if (targets.some((target) => target.agentId === context.agent.id)) {
      return { text: "You cannot wait for yourself.", isError: true };
    }
    const deadline = Date.now() + input.timeout_seconds * 1000;
    let states = await readStates(paseo, targets);
    while (!context.signal.aborted && Date.now() < deadline) {
      const stopped = states.filter((state) => state.stopped).length;
      if (input.mode === "any" ? stopped > 0 : stopped === states.length) break;
      await sleep(POLL_MS, context.signal);
      states = await readStates(paseo, targets);
    }
    const lines: string[] = [];
    for (const state of states) {
      lines.push(`## ${state.target.label} (${state.target.agentId}): ${state.description}`);
      if (state.stopped) {
        const final = await finalMessage(paseo, state.target.agentId).catch(() => null);
        lines.push(final ?? "(no final message)");
      }
      lines.push("");
    }
    const timedOut = states.some((state) => !state.stopped) && input.mode === "all";
    return text(`${timedOut ? `Timed out after ${input.timeout_seconds}s.\n\n` : ""}${lines.join("\n")}`.trim());
  },
});

interface TargetState {
  target: ResolvedTarget;
  stopped: boolean;
  description: string;
}

async function readStates(paseo: PaseoApi, targets: ResolvedTarget[]): Promise<TargetState[]> {
  return Promise.all(
    targets.map(async (target) => {
      const snapshot = await paseo.agents.ref(target.agentId).refresh().catch(() => null);
      if (!snapshot) return { target, stopped: true, description: "no longer exists" };
      const agent = snapshot.agent;
      const queued = undeliveredFor(target.agentId).length;
      if (agent.pendingPermissions.length > 0) {
        return { target, stopped: true, description: "waiting for a permission decision" };
      }
      if (agent.status === "running" || agent.status === "initializing") {
        return { target, stopped: false, description: agent.status };
      }
      // Messages still queued for it mean it is about to start another turn.
      if (queued > 0) return { target, stopped: false, description: `${agent.status}, ${queued} message(s) queued` };
      const error = agent.lastError && agent.status === "error" ? ` (${agent.lastError})` : "";
      return { target, stopped: true, description: `${agent.status}${error}` };
    }),
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

const read = defineAgentTool({
  name: "orchestrator_read",
  title: "Orchestrator: read a workspace",
  description:
    "Read the recent conversation of another workspace or agent: its prompts, replies, and tool calls. " +
    "Use it to check what a workspace is doing before directing it.",
  input: z.object({
    target: z.string().min(1).describe("Workspace name or id, or agent id"),
    limit: z.number().int().min(1).max(100).default(25).describe("Timeline entries to read, newest last"),
  }),
  async execute(input, context) {
    const { paseo, directory } = await setup(context);
    const target = resolveTarget(directory, input.target);
    const page = await paseo.agents.ref(target.agentId).timeline.refetch({ direction: "tail", limit: input.limit });
    const status = page.agent ? `${page.agent.status}` : "unknown status";
    const lines = page.entries.flatMap((entry) => {
      const item = entry.item;
      switch (item.type) {
        case "user_message":
          return [`[user] ${preview(item.text, 1200)}`];
        case "assistant_message":
          return [`[assistant] ${preview(item.text, 2000)}`];
        case "tool_call":
          return [`[tool] ${item.name} (${item.status})`];
        case "error":
          return [`[error] ${item.message}`];
        case "todo":
          return [`[todo] ${item.items.map((task) => `${task.completed ? "✓" : "○"} ${task.text}`).join("; ")}`];
        default:
          return [];
      }
    });
    return text(`${target.label} (${target.agentId}), ${status}:\n\n${lines.join("\n") || "(empty)"}`);
  },
});

const spawn = defineAgentTool({
  name: "orchestrator_spawn",
  title: "Orchestrator: start a workspace",
  description:
    "Create a new workspace with an agent working on a task. By default it gets its own git worktree on a new " +
    "branch of the project, so several workspaces can work in parallel without touching each other's files. " +
    "With report_back (on by default) the agent's final message comes back to you when it finishes. " +
    "`project` is an existing workspace's name or id, or an absolute path to a repository.",
  input: z.object({
    project: z.string().min(1).describe("Workspace name or id whose project to use, or an absolute path"),
    task: z.string().min(1).describe("Instructions for the new agent; be complete, it starts with no context"),
    title: z.string().optional().describe("Workspace title"),
    branch: z.string().optional().describe("Name for the new branch when isolation is worktree"),
    isolation: z
      .enum(["worktree", "directory"])
      .default("worktree")
      .describe("worktree: new branch in its own checkout. directory: work in the project directory itself"),
    provider: z
      .string()
      .optional()
      .describe('Agent provider and model as "provider/model", e.g. "claude/opus"; defaults to yours'),
    report_back: z.boolean().default(true),
  }),
  async execute(input, context) {
    const { paseo, directory, selfLabel } = await setup(context);
    const self = context.agent.id;

    let cwd: string;
    let projectId: string | undefined;
    if (isAbsolute(input.project)) {
      cwd = input.project;
    } else {
      const query = input.project.trim().toLowerCase();
      const workspace = directory.workspaces.find(
        (candidate) => candidate.id === input.project || candidate.name.toLowerCase() === query,
      );
      if (!workspace?.directory) {
        return { text: `No workspace "${input.project}" with a directory. Use orchestrator_overview or an absolute path.`, isError: true };
      }
      cwd = workspace.directory;
      projectId = workspace.projectId;
    }

    let provider = input.provider;
    if (!provider) {
      const mine = (await paseo.agents.ref(self).refresh())?.agent;
      provider = mine?.model ? `${mine.provider}/${mine.model}` : (mine?.provider ?? context.agent.provider);
    }

    const created = await paseo.workspaces.create({
      title: input.title,
      callerAgentId: self,
      firstAgentContext: { prompt: input.task },
      metadata: { "orchestrator.parentAgentId": self },
      source:
        input.isolation === "worktree"
          ? {
              kind: "worktree",
              cwd,
              ...(projectId ? { projectId } : {}),
              action: "branch-off",
              ...(input.branch ? { branchName: input.branch } : {}),
            }
          : { kind: "directory", path: cwd, ...(projectId ? { projectId } : {}) },
    });

    const threadId = newId("t");
    const prompt = formatBatch([
      {
        kind: "task",
        threadId,
        from: selfLabel,
        fromAgentId: self,
        expectsReply: false,
        body: input.task,
      },
    ]);
    const agent = await created.agents.create({
      config: { provider },
      title: input.title,
      prompt,
      metadata: { "orchestrator.parentAgentId": self },
    });
    createThread(self, agent.id, threadId);

    const message = addMessage({
      threadId,
      kind: "task",
      fromAgentId: self,
      fromLabel: selfLabel,
      toAgentId: agent.id,
      toLabel: created.name ?? input.title ?? agent.id,
      body: input.task,
      expectsReply: false,
      reportBack: input.report_back,
    });
    updateMessages([message.id], { deliveredAt: new Date().toISOString() });

    return text(
      `Started workspace "${created.name ?? input.title ?? created.id}" (${created.id}) with agent ${agent.id} ` +
        `(${provider}) in ${created.directory ?? cwd}. Thread ${threadId}.` +
        (input.report_back ? " Its final message comes back to you when it finishes." : ""),
    );
  },
});

export const orchestratorTools: AgentToolDefinition[] = [overview, send, ask, reply, inbox, wait, read, spawn];

/** Turn-end hook entry: answers, reports, and queued deliveries for the agent. */
export function handleTurnEnded(paseo: PaseoApi, agentId: string, outcome: Parameters<typeof onTurnEnded>[2]) {
  rememberPaseo(paseo);
  return onTurnEnded(paseo, agentId, outcome);
}
