import type { LifecycleEvent } from "../shared/settings";
import { client, type LinearSettings } from "./issues";

/** Finished issues are never moved automatically, so archiving an old workspace can't reopen them. */
const FINAL_STATE_TYPES = new Set(["completed", "canceled"]);

/**
 * Moves an explicitly linked issue to the status configured for a lifecycle event.
 * Never throws: a Linear failure must not affect the workspace or agent lifecycle.
 */
export async function applyLifecycleStatus(
  event: LifecycleEvent,
  identifier: unknown,
  settings: LinearSettings,
): Promise<void> {
  if (typeof identifier !== "string" || !identifier) return;
  try {
    const state = await settings.read();
    if (state.status !== "ready") return;
    const target = state.values.statusRules[event]?.trim();
    if (!target) return;

    const linear = await client(settings);
    const issue = await linear.issue(identifier);
    if (!issue) {
      console.warn(`[linear] ${event}: issue ${identifier} not found`);
      return;
    }
    if (issue.state.name.trim().toLowerCase() === target.toLowerCase()) return;
    if (FINAL_STATE_TYPES.has(issue.state.type)) return;

    const { states } = await linear.teamStates(issue.teamId);
    const next = states.find((candidate) => candidate.name.trim().toLowerCase() === target.toLowerCase());
    if (!next) {
      console.warn(`[linear] ${event}: team ${issue.teamKey} has no "${target}" status; ${identifier} unchanged`);
      return;
    }
    await linear.setIssueState(issue.id, next.id);
  } catch (error) {
    console.warn(`[linear] ${event}: could not update the status of ${identifier}`, error);
  }
}
