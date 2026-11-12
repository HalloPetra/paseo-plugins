import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { PrefillEvent } from "../shared/prefill";

export const MAX_LENGTH = 4000;

/** Proposed during the running turn; released when that turn completes. */
const pending = new Map<string, string>();
/** Released proposals, replayed to clients that connect later. Cleared when the agent's next turn starts. */
const ready = new Map<string, PrefillEvent>();
const listeners = new Set<(event: PrefillEvent) => void>();

let counter = 0;

export const prefillTool = defineAgentTool({
  name: "prefill_answer",
  title: "Prefill the user's reply",
  description:
    "Prefill the user's message box with the reply you expect them to send next, so they can accept it by pressing Enter " +
    "(they can still edit or replace it). Call this as the very last action of a turn whenever you end by asking the user " +
    "a question, offering options, or proposing a next step: pass the answer you recommend, written in the user's voice " +
    "as they would type it (for example \"Yes, go with option B\" or \"Commit and open a PR\"). Keep it short and specific. " +
    "Do not call it when there is no natural next reply. Only the last call in a turn counts. Still state your question " +
    "or proposal in your normal response; the user sees the prefilled text only after your turn ends.",
  input: z.object({
    text: z
      .string()
      .min(1)
      .max(MAX_LENGTH)
      .describe("The reply to prefill, phrased as the user would send it."),
  }),
  async execute({ text }, { agent }) {
    pending.set(agent.id, text.trim());
    return { text: "The reply will be prefilled in the user's composer when your turn ends. End your turn now." };
  },
});

export function onTurnStarted(agentId: string): void {
  pending.delete(agentId);
  ready.delete(agentId);
}

export function onTurnEnded(agentId: string, completed: boolean): void {
  const text = pending.get(agentId);
  pending.delete(agentId);
  if (!completed || !text) return;
  const event: PrefillEvent = { agentId, key: `${Date.now()}-${++counter}`, text };
  ready.set(agentId, event);
  for (const listener of listeners) listener(event);
}

export function forget(agentId: string): void {
  pending.delete(agentId);
  ready.delete(agentId);
}

/** Replays released proposals, then forwards new ones until the returned remover runs. */
export function listen(listener: (event: PrefillEvent) => void): () => void {
  for (const event of ready.values()) listener(event);
  listeners.add(listener);
  return () => listeners.delete(listener);
}
