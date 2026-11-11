import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { checkLogsItem } from "../shared/check-logs";
import { CHECK_LOGS_SOURCE_ID, type PullRequest, checkLogsRpc } from "../shared/pr";
import { AgentPromptButton, appendPrompt } from "./agent-prompt";

type Colors = PluginTheme["colors"];

function buildPrompt(pr: PullRequest, failing: { name: string; workflow: string | null }[]): string {
  const list = failing.map((c) => `- ${c.workflow ? `${c.workflow} / ` : ""}${c.name}`).join("\n");
  return [
    `CI is failing on PR #${pr.number} (${pr.headRefName} → ${pr.baseRefName}). Failing checks:`,
    "",
    list,
    "",
    "The attached document has the annotations and failed-step logs for each check.",
    "Find the root cause of each failure, fix it, and run the relevant tests or commands locally to confirm. Then commit and push.",
    "If a failure is unrelated to this PR (a flaky test, infrastructure, a missing secret), say so instead of changing code.",
  ].join("\n");
}

/** Card in the Checks section: fills an agent's composer with a fix prompt and the failing logs. */
export function FixChecksCard({
  pr,
  directory,
  workspaceId,
  colors,
}: {
  pr: PullRequest;
  directory: string;
  workspaceId: string;
  colors: Colors;
}) {
  const fetchLogs = useRpc(checkLogsRpc);
  const failingCount = pr.checks.filter((c) => c.status === "failure").length;

  return (
    <View style={{ gap: 6, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: colors.statusDanger, backgroundColor: colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="CircleX" size={14} color={colors.statusDanger} />
        <Text style={{ color: colors.statusDanger, fontSize: 13, flex: 1 }}>
          {failingCount} {failingCount === 1 ? "check is" : "checks are"} failing
        </Text>
      </View>
      <AgentPromptButton
        workspaceId={workspaceId}
        label="Fix failing checks"
        pendingLabel="Fetching logs…"
        icon="Wrench"
        tone={colors.statusDanger}
        colors={colors}
        fill={async (composer) => {
          const { text, failing } = await fetchLogs({ directory, number: pr.number });
          if (failing.length === 0) throw new Error("No checks are failing anymore.");
          appendPrompt(composer, buildPrompt(pr, failing));
          const item = checkLogsItem(pr, text);
          if (composer.attachments.some((a) => a.sourceId === CHECK_LOGS_SOURCE_ID && a.item.id === item.id))
            composer.removeAttachment({ sourceId: CHECK_LOGS_SOURCE_ID, itemId: item.id });
          composer.addAttachment({ sourceId: CHECK_LOGS_SOURCE_ID, item });
        }}
      />
    </View>
  );
}
