import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { type PullRequest, checkLogsRpc } from "../shared/pr";
import { AgentSendButton } from "./agent-prompt";

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

/** Card in the Checks section: sends an agent a fix prompt with the failing logs attached. */
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
      <AgentSendButton
        workspaceId={workspaceId}
        label="Fix failing checks"
        pendingLabel="Sending…"
        icon="Wrench"
        tone={colors.statusDanger}
        colors={colors}
        message={async () => {
          const { text, failing } = await fetchLogs({ directory, number: pr.number });
          if (failing.length === 0) throw new Error("No checks are failing anymore.");
          return {
            text: buildPrompt(pr, failing),
            documents: [
              {
                title: `Failing check logs for #${pr.number}`,
                text,
                resource: {
                  resourceType: "ci-logs",
                  id: `checks-${pr.url}`,
                  identifier: `#${pr.number} checks`,
                  title: `Failing check logs for #${pr.number}`,
                  url: `${pr.url}/checks`,
                },
              },
            ],
          };
        }}
      />
    </View>
  );
}
