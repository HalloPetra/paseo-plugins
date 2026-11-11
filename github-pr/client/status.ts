import type { PluginTheme } from "@getpaseo/plugin";
import type { PullRequest } from "../shared/pr";

type Colors = PluginTheme["colors"];

/** GitHub's merged purple. Paseo themes have no purple token; this one reads on light and dark. */
export const MERGED_COLOR = "#8957e5";

export type ChecksRollup = "failure" | "pending" | "success" | "none";

export function checksRollup(pr: PullRequest): ChecksRollup {
  if (pr.checks.length === 0) return "none";
  if (pr.checks.some((c) => c.status === "failure")) return "failure";
  if (pr.checks.some((c) => c.status === "pending")) return "pending";
  return "success";
}

/** One color summarizing the PR for the header button. */
export function prStatusColor(pr: PullRequest, colors: Colors): string {
  if (pr.state === "MERGED") return MERGED_COLOR;
  if (pr.state === "CLOSED") return colors.foregroundMuted;
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") return colors.statusDanger;
  const rollup = checksRollup(pr);
  if (rollup === "failure") return colors.statusDanger;
  if (rollup === "pending") return colors.statusWarning;
  if (pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "BEHIND") return colors.statusWarning;
  return colors.statusSuccess;
}

export function prStatusIcon(pr: PullRequest): string {
  if (pr.state === "MERGED") return "GitMerge";
  if (pr.state === "CLOSED") return "GitPullRequestClosed";
  if (pr.isDraft) return "GitPullRequestDraft";
  return "GitPullRequest";
}
