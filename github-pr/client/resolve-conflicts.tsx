import type { PluginTheme } from "@getpaseo/plugin";
import type { PullRequest } from "../shared/pr";
import { AgentSendButton } from "./agent-prompt";

type Colors = PluginTheme["colors"];

function buildPrompt(pr: PullRequest): string {
  const base = pr.baseRefName;
  return [
    `PR #${pr.number} (${pr.headRefName} → ${base}) has merge conflicts with ${base}.`,
    "",
    `Get the latest ${base} (\`git fetch origin ${base}\`) and merge \`origin/${base}\` into this branch. Don't rebase, so no force push is needed.`,
    "Resolve every conflict, keeping the intent of both sides. Where they genuinely contradict, prefer this branch's change and tell me what you chose.",
    "Then run the typecheck and the tests that cover the conflicted files, fix anything the merge broke, commit the merge, and push.",
  ].join("\n");
}

export function ResolveConflictsButton({
  pr,
  workspaceId,
  colors,
}: {
  pr: PullRequest;
  workspaceId: string;
  colors: Colors;
}) {
  return (
    <AgentSendButton
      workspaceId={workspaceId}
      label="Resolve conflicts"
      pendingLabel="Sending…"
      icon="GitMerge"
      tone={colors.statusWarning}
      colors={colors}
      message={() => ({ text: buildPrompt(pr) })}
    />
  );
}
