import type { PluginTheme } from "@getpaseo/plugin";
import { type AgentRef, useAgent, useAgents, useComposers, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CHECK_LOGS_SOURCE_ID, type PullRequest, checkLogsRpc } from "../shared/pr";
import { checkLogsItem } from "../shared/check-logs";
import { Dropdown } from "./dropdown";
import { Spinner } from "./spinner";

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

function useAgentTitle(ref: AgentRef | undefined): string {
  const title = useAgent(ref?.id ?? "", (a) => a.title);
  return title || "Untitled agent";
}

function AgentLabel({ agentRef, colors }: { agentRef: AgentRef; colors: Colors }) {
  const agent = useAgent(agentRef.id, (a) => ({ title: a.title, status: a.status, provider: a.provider }));
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
        {agent?.title || "Untitled agent"}
      </Text>
      {agent && (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {agent.provider} · {agent.status}
        </Text>
      )}
    </View>
  );
}

/** Fills an agent's composer with a fix prompt and attaches the failing checks' logs. */
export function FixChecksButton({
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
  const agents = useAgents({
    where: (a) => a.workspaceId === workspaceId && a.status !== "closed" && a.parentAgentId === null,
    orderBy: ["lastActivityAt", "desc"],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const target = agents.find((a) => a.id === selectedId) ?? agents[0];
  const targetTitle = useAgentTitle(target);
  const composers = useComposers({ agentId: target?.id ?? "" });
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const fetchLogs = useRpc(checkLogsRpc);
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const composer = composers[0];
      if (!composer) throw new Error("Could not reach that agent's composer.");
      const { text, failing } = await fetchLogs({ directory, number: pr.number });
      if (failing.length === 0) throw new Error("No checks are failing anymore.");
      const prompt = buildPrompt(pr, failing);
      const existing = composer.prompt.trim();
      composer.setPrompt(existing ? `${existing}\n\n${prompt}` : prompt);
      const item = checkLogsItem(pr, text);
      if (composer.attachments.some((a) => a.sourceId === CHECK_LOGS_SOURCE_ID && a.item.id === item.id))
        composer.removeAttachment({ sourceId: CHECK_LOGS_SOURCE_ID, itemId: item.id });
      composer.addAttachment({ sourceId: CHECK_LOGS_SOURCE_ID, item });
      await composer.focus();
    },
    onSuccess: () => toast.show("Fix prompt ready. Review it and send.", { variant: "success" }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const disabled = !target || mutation.isPending;
  const bg = disabled ? colors.surface2 : colors.statusDanger;
  const fg = disabled ? colors.foregroundMuted : colors.accentForeground;
  const failingCount = pr.checks.filter((c) => c.status === "failure").length;

  return (
    <View style={{ gap: 6, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: colors.statusDanger, backgroundColor: colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="CircleX" size={14} color={colors.statusDanger} />
        <Text style={{ color: colors.statusDanger, fontSize: 13, flex: 1 }}>
          {failingCount} {failingCount === 1 ? "check is" : "checks are"} failing
        </Text>
      </View>
      <View
        ref={anchorRef}
        collapsable={false}
        style={{ flexDirection: "row", borderRadius: 6, overflow: "hidden", opacity: mutation.isPending ? 0.7 : 1 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={target ? `Fix failing checks with ${targetTitle}` : "Fix failing checks"}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => mutation.mutate()}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: bg }}
        >
          {mutation.isPending ? <Spinner size={14} color={fg} /> : <Icon name="Wrench" size={14} color={fg} />}
          <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
            {mutation.isPending ? "Fetching logs…" : "Fix failing checks"}
          </Text>
        </Pressable>
        {agents.length > 1 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose agent"
            accessibilityState={{ expanded: menuOpen, disabled: mutation.isPending }}
            disabled={mutation.isPending}
            onPress={() => setMenuOpen((open) => !open)}
            style={{ justifyContent: "center", paddingHorizontal: 10, backgroundColor: bg, borderLeftWidth: 1, borderLeftColor: colors.surface0 }}
          >
            <Icon name={menuOpen ? "ChevronUp" : "ChevronDown"} size={14} color={fg} />
          </Pressable>
        )}
      </View>
      {!target && (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Start an agent in this workspace to fix checks.</Text>
      )}
      <Dropdown
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={anchorRef}
        options={agents.map((ref) => ({ value: ref.id, label: <AgentLabel agentRef={ref} colors={colors} /> }))}
        selected={target?.id ?? ""}
        onSelect={setSelectedId}
        colors={colors}
      />
    </View>
  );
}
