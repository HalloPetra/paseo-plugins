import type { PluginTheme } from "@getpaseo/plugin";
import { type AgentRef, type PluginPanelProps, useAgent, useAgents, usePaseo } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { createContext, useContext, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Dropdown } from "./dropdown";
import { Spinner } from "./spinner";

type Colors = PluginTheme["colors"];

/** The panel's navigation, so a send can jump to the agent it messaged. */
export const PanelNavigationContext = createContext<PluginPanelProps<unknown>["navigation"]>(undefined);

/** A text document sent alongside the message, shown as an attachment in the agent's timeline. */
export interface MessageDocument {
  title: string;
  text: string;
  resource: { resourceType: string; id: string; identifier: string; title: string; url: string };
}

export interface AgentMessage {
  text: string;
  documents?: MessageDocument[];
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
 * A full-width button that sends a message to an agent: the most recently active top-level
 * agent in the workspace by default, or one picked from the chevron. A running turn is
 * steered rather than interrupted. Afterwards the agent is opened.
 */
export function AgentSendButton({
  workspaceId,
  label,
  pendingLabel,
  icon,
  tone,
  colors,
  message,
}: {
  workspaceId: string;
  label: string;
  pendingLabel: string;
  icon: string;
  /** Background of the enabled button. */
  tone: string;
  colors: Colors;
  /** Builds the message at press time (e.g. fetching logs). */
  message(): Promise<AgentMessage> | AgentMessage;
}) {
  const agents = useAgents({
    where: (a) => a.workspaceId === workspaceId && a.status !== "closed" && a.parentAgentId === null,
    orderBy: ["lastActivityAt", "desc"],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const target = agents.find((a) => a.id === selectedId) ?? agents[0];
  const targetTitle = useAgent(target?.id ?? "", (a) => a.title) || "Untitled agent";
  const paseo = usePaseo();
  const navigation = useContext(PanelNavigationContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("No agent to send to.");
      const { text, documents = [] } = await message();
      await paseo.agents.ref(target).send(text, {
        activeTurnBehavior: "steer",
        attachments: documents.map((doc) => ({
          type: "text" as const,
          mimeType: "text/plain" as const,
          title: doc.title,
          text: doc.text,
          externalResource: { provider: "github", providerLabel: "GitHub", ...doc.resource },
        })),
      });
      return target.id;
    },
    onSuccess: (agentId) => {
      toast.show(`Sent to ${targetTitle}`, { variant: "success" });
      navigation?.openAgent({ agentId });
    },
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
