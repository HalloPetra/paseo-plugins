import type { PaseoApi } from "@getpaseo/client";
import { defineAgentTool, type AgentToolContext, type AgentToolDefinition } from "@getpaseo/plugin/server";
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
} from "./directory";
import { finalMessage, rememberPaseo, sendMessage, waitForAnswer } from "./relay";
import {
  addMessage,
  createThread,
  getThread,
  newId,
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
  const parts = [agent.id, agent.title ? `"${agent.title}"` : "(untitled)", agent.status];
  parts.push(agent.model ? `${agent.provider}/${agent.model}` : agent.provider);
  if (agent.pendingPermissions > 0) parts.push(`${agent.pendingPermissions} permission request(s) pending`);
  const queued = undeliveredFor(agent.id).length;
  if (queued > 0) parts.push(`${queued} message(s) queued for it`);
  if (agent.id === selfId) parts.push("← you");
  return parts.join(" · ");
}

async function setup(context: AgentToolContext): Promise<{ paseo: PaseoApi; directory: Directory; selfLabel: string }> {
  rememberPaseo(context.paseo);
  const workspaceId = context.agent.workspaceId;
  if (!workspaceId) throw new Error("The orchestrator tools only work inside a workspace.");
  const directory = await loadDirectory(context.paseo, workspaceId);
  return { paseo: context.paseo, directory, selfLabel: `Orchestrator (${directory.projectName})` };
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
    "List the workspaces of your project with their agents and status. You are this project's orchestrator: " +
    "use these tools to hand out work to the other workspaces, ask them questions, and collect results. " +
    "A workspace is addressed by its name, id, or directory; messages go to its oldest live agent.",
  input: z.object({}),
  async execute(_input, context) {
    const { directory } = await setup(context);
    const self = context.agent.id;
    const others = directory.workspaces.filter((workspace) => workspace.id !== directory.self.id);
    const lines = [
      `Project ${directory.projectName} (${directory.projectRoot}). You are its orchestrator (agent ${self}).`,
      "",
      `Other workspaces (${others.length}):`,
    ];
    for (const workspace of others) {
      const where = workspace.directory ? ` · ${workspace.directory}` : "";
      lines.push(`- "${workspace.name}" · ${workspace.id} · ${workspace.status}${where}`);
      if (workspace.agents.length === 0) lines.push("    (no live agent)");
      for (const agent of workspace.agents) {
        const marker = agent.id === primaryAgent(workspace)?.id ? "*" : "-";
        lines.push(`    ${marker} ${describeAgent(agent, self)}`);
      }
    }
    if (others.length === 0) lines.push("(none yet; start one with orchestrator_spawn)");
    lines.push("", "* marks the agent that receives messages sent to the workspace.");
    return text(lines.join("\n"));
  },
});

function resolveRecipients(directory: Directory, self: string, to: string | string[] | undefined, threadId?: string) {
  if (to === undefined) {
    if (!threadId) throw new Error("Give `to`, or a thread_id to continue.");
    const thread = getThread(threadId);
    if (!thread || !thread.agents.includes(self)) throw new Error(`Thread ${threadId} is not one of yours.`);
    const other = thread.agents.find((id) => id !== self)!;
    return [{ agentId: other, label: agentLabel(directory, other) }];
  }
  const list = Array.isArray(to) ? to : [to];
  if (list.length === 1 && list[0]!.trim().toLowerCase() === "all") {
    const targets = directory.workspaces
      .filter((workspace) => workspace.id !== directory.self.id)
      .map(primaryAgent)
      .filter((agent): agent is DirectoryAgent => agent !== undefined)
      .map((agent) => ({ agentId: agent.id, label: agentLabel(directory, agent.id) }));
    if (targets.length === 0) throw new Error("No other workspace in this project has a live agent.");
    return targets;
  }
  const seen = new Set<string>();
  return list
    .map((entry) => resolveTarget(directory, entry))
    .filter((target) => (seen.has(target.agentId) ? false : (seen.add(target.agentId), true)));
}

const send = defineAgentTool({
  name: "orchestrator_send",
  title: "Orchestrator: send a message",
  description:
    "Send a message to workspaces in your project without waiting. An idle receiver gets it as a prompt right " +
    "away; a busy one as soon as its current turn ends. `to` takes workspace names, ids or directories, agent " +
    'ids, a list of them, or "all". With report_back, the receiver\'s final message comes back to you as a new ' +
    "prompt when it has handled yours: the way to hand out work and hear back. Pass thread_id to continue a " +
    "conversation; `to` may then be left out.",
  input: z.object({
    to: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional()
      .describe('Workspace name, id or directory, agent id, a list of them, or "all"'),
    message: z.string().min(1).describe("Message text; Markdown is fine. The receiver starts with no other context"),
    thread_id: z.string().optional().describe("Continue this thread instead of starting a new one"),
    report_back: z.boolean().default(false).describe("Send you the receiver's final message once it has handled this"),
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
          expectsReply: false,
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

const ask = defineAgentTool({
  name: "orchestrator_ask",
  title: "Orchestrator: ask and wait",
  description:
    "Ask a workspace in your project a question and wait for the answer: the receiver's final message once it " +
    "has handled the question. If the timeout passes, the answer arrives later as a new prompt.",
  input: z.object({
    to: z.string().min(1).describe("Workspace name, id or directory, or agent id"),
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
      // If the wait times out, the answer still comes back as a report.
      reportBack: true,
    });
    if (question.dropped) return { text: `Could not deliver: ${question.dropped}`, isError: true };
    const answer = await waitForAnswer(question, input.timeout_seconds * 1000, context.signal);
    const header = `Thread ${question.threadId} with ${target.label}.`;
    if (!answer) {
      return text(
        `${header} No answer within ${input.timeout_seconds}s (${deliveryNote(question)}). ` +
          "The answer arrives as a new prompt when they finish.",
      );
    }
    return text(
      `${header} Their turn ${answer.outcome}. ` + (answer.body ? `Answer:\n\n${answer.body}` : "They ended without a final message."),
    );
  },
});

const inbox = defineAgentTool({
  name: "orchestrator_inbox",
  title: "Orchestrator: conversations",
  description: "List your conversations with the project's workspaces, newest first, or read one thread in full with thread_id.",
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
      const lines = threadMessages(thread.id)
        .slice(-input.limit)
        .map((message) => {
          const who = message.fromAgentId === self ? "you" : message.fromLabel;
          return `[${message.createdAt}] ${who} (${message.kind}, ${deliveryNote(message)}):\n${message.body}`;
        });
      return text(`Thread ${thread.id}, ${thread.hops} message(s):\n\n${lines.join("\n\n")}`);
    }
    const threads = threadsFor(self).slice(0, input.limit);
    if (threads.length === 0) return text("No conversations yet.");
    const lines = threads.map((thread) => {
      const other = thread.agents.find((id) => id !== self)!;
      const last = threadMessages(thread.id).at(-1);
      const lastLine = last ? `${last.fromAgentId === self ? "you" : last.fromLabel}: ${preview(last.body)}` : "(empty)";
      return `- ${thread.id} with ${agentLabel(directory, other)} · ${thread.hops} message(s)\n    ${lastLine}`;
    });
    return text(lines.join("\n"));
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
      if (agent.pendingPermissions.length > 0) {
        return { target, stopped: true, description: "waiting for a permission decision" };
      }
      if (agent.status === "running" || agent.status === "initializing") {
        return { target, stopped: false, description: agent.status };
      }
      // Messages still queued for it mean it is about to start another turn.
      const queued = undeliveredFor(target.agentId).length;
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

const wait = defineAgentTool({
  name: "orchestrator_wait",
  title: "Orchestrator: wait for workspaces",
  description:
    "Wait until the given workspaces stop working (idle, failed, or waiting on a permission request), then " +
    'return each one\'s status and final message. mode "any" returns as soon as one stops. Use it to collect ' +
    "results after handing out work, instead of polling.",
  input: z.object({
    targets: z.array(z.string().min(1)).min(1).describe("Workspace names, ids or directories, or agent ids"),
    mode: z.enum(["all", "any"]).default("all"),
    timeout_seconds: z.number().int().min(5).max(MAX_WAIT_SECONDS).default(300),
  }),
  async execute(input, context) {
    const { paseo, directory } = await setup(context);
    const targets = input.targets.map((target) => resolveTarget(directory, target));
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
      if (state.stopped) lines.push((await finalMessage(paseo, state.target.agentId).catch(() => null)) ?? "(no final message)");
      lines.push("");
    }
    const timedOut = input.mode === "all" && states.some((state) => !state.stopped);
    return text(`${timedOut ? `Timed out after ${input.timeout_seconds}s.\n\n` : ""}${lines.join("\n")}`.trim());
  },
});

const read = defineAgentTool({
  name: "orchestrator_read",
  title: "Orchestrator: read a workspace",
  description:
    "Read the recent conversation of a workspace in your project: its prompts, replies, and tool calls. " +
    "Use it to check what a workspace is doing before directing it.",
  input: z.object({
    target: z.string().min(1).describe("Workspace name, id or directory, or agent id"),
    limit: z.number().int().min(1).max(100).default(25).describe("Timeline entries to read, newest last"),
  }),
  async execute(input, context) {
    const { paseo, directory } = await setup(context);
    const target = resolveTarget(directory, input.target);
    const page = await paseo.agents.ref(target.agentId).timeline.refetch({ direction: "tail", limit: input.limit });
    const status = page.agent ? page.agent.status : "unknown status";
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
    "Start a new workspace in your project with an agent working on a task. By default it gets its own git " +
    "worktree on a new branch, so several workspaces can work in parallel without touching each other's files. " +
    "With report_back (on by default) the agent's final message comes back to you when it finishes.",
  input: z.object({
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
              cwd: directory.projectRoot,
              projectId: directory.projectId,
              action: "branch-off",
              ...(input.branch ? { branchName: input.branch } : {}),
            }
          : { kind: "directory", path: directory.projectRoot, projectId: directory.projectId },
    });

    const threadId = newId("t");
    const prompt = formatBatch([
      { kind: "task", threadId, from: selfLabel, fromAgentId: self, expectsReply: input.report_back, body: input.task },
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
        `(${provider}) in ${created.directory ?? directory.projectRoot}. Thread ${threadId}.` +
        (input.report_back ? " Its final message comes back to you when it finishes." : ""),
    );
  },
});

export const orchestratorTools: AgentToolDefinition[] = [overview, send, ask, inbox, wait, read, spawn];
