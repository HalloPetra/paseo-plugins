import type { PluginTheme } from "@getpaseo/plugin";
import {
  type AgentRef,
  type PluginComposer,
  useAgent,
  useAgents,
  useComposers,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Dropdown } from "./dropdown";
import { Spinner } from "./spinner";

type Colors = PluginTheme["colors"];

/** Appends `prompt` after whatever the user already typed. */
export function appendPrompt(composer: PluginComposer, prompt: string) {
  const existing = composer.prompt.trim();
  composer.setPrompt(existing ? `${existing}\n\n${prompt}` : prompt);
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

/**
 * A full-width button that prepares a prompt in an agent's composer: the most recently
 * active top-level agent in the workspace by default, or one picked from the chevron.
 * `fill` writes the prompt (and any attachments); the composer is focused afterwards.
 * Nothing is sent.
 */
export function AgentPromptButton({
  workspaceId,
  label,
  pendingLabel,
  icon,
  tone,
  colors,
  fill,
}: {
  workspaceId: string;
  label: string;
  pendingLabel: string;
  icon: string;
  /** Background of the enabled button. */
  tone: string;
  colors: Colors;
  fill(composer: PluginComposer): Promise<void> | void;
}) {
  const agents = useAgents({
    where: (a) => a.workspaceId === workspaceId && a.status !== "closed" && a.parentAgentId === null,
    orderBy: ["lastActivityAt", "desc"],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const target = agents.find((a) => a.id === selectedId) ?? agents[0];
  const targetTitle = useAgent(target?.id ?? "", (a) => a.title) || "Untitled agent";
  const composers = useComposers({ agentId: target?.id ?? "" });
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const composer = composers[0];
      if (!composer) throw new Error("Could not reach that agent's composer.");
      await fill(composer);
      await composer.focus();
    },
    onSuccess: () => toast.show("Prompt ready. Review it and send.", { variant: "success" }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const disabled = !target || mutation.isPending;
  const bg = disabled ? colors.surface2 : tone;
  const fg = disabled ? colors.foregroundMuted : colors.accentForeground;

  return (
    <View style={{ gap: 4 }}>
      <View
        ref={anchorRef}
        collapsable={false}
        style={{ flexDirection: "row", borderRadius: 6, overflow: "hidden", opacity: mutation.isPending ? 0.7 : 1 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={target ? `${label} with ${targetTitle}` : label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => mutation.mutate()}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: bg }}
        >
          {mutation.isPending ? <Spinner size={14} color={fg} /> : <Icon name={icon} size={14} color={fg} />}
          <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
            {mutation.isPending ? pendingLabel : label}
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
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Start an agent in this workspace to use this.</Text>
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
