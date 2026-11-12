import { defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** A reply the agent proposed, ready to drop into its composer once its turn has completed. */
export const prefillEvent = z.object({
  agentId: z.string(),
  /** Unique per proposal, so a client applies each one once even when it is replayed. */
  key: z.string(),
  text: z.string(),
});

export type PrefillEvent = z.infer<typeof prefillEvent>;

export const prefillWatch = defineSubscription({
  name: "prefill.watch",
  input: z.object({}),
  event: prefillEvent,
});
