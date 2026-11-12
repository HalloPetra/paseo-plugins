import { type PluginNewWorkspaceItemProps, useNewWorkspace, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text } from "react-native";
import { ORCHESTRATOR_ROLE, ROLE_KEY, isOrchestratorMetadata, projectOrchestratorRpc } from "../shared/orchestrator";

const ICON = "Network";
const SIZE = 28;
/**
 * The on state uses the same blue as Paseo's own active composer toggles. The theme has no blue
 * token (its accent is not blue in every theme), so it is fixed; it reads on light and dark.
 */
const ACTIVE_BLUE = "#3b82f6";
const ACTIVE_BLUE_BACKGROUND = "rgba(59, 130, 246, 0.15)";

/**
 * An icon toggle in the New workspace setup row. On, the workspace becomes the project's
 * orchestrator: it works in the project directory, gets the orchestrator tools, and is pinned.
 * A project has at most one, so the toggle is hidden once it has. On a phone it draws as a
 * full-width row with a label.
 */
export function OrchestratorToggle({ theme, layout }: PluginNewWorkspaceItemProps) {
  const newWorkspace = useNewWorkspace();
  const findOrchestrator = useRpc(projectOrchestratorRpc);
  const projectId = newWorkspace.project?.id ?? null;
  const existing = useQuery({
    queryKey: ["project-orchestrator", projectId],
    queryFn: () => findOrchestrator({ projectId: projectId! }),
    enabled: projectId !== null,
  });
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);

  const on = isOrchestratorMetadata(newWorkspace.metadata);
  const active = on || (hovered && !busy);

  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: layout.compact ? ("flex-start" as const) : ("center" as const),
        gap: 10,
        height: layout.compact ? 44 : SIZE,
        minWidth: SIZE,
        paddingHorizontal: layout.compact ? 12 : 0,
        borderRadius: 8,
        backgroundColor: on ? ACTIVE_BLUE_BACKGROUND : hovered && !busy ? theme.colors.surface1 : "transparent",
        alignSelf: layout.compact ? ("stretch" as const) : ("flex-start" as const),
      },
      label: { color: on ? ACTIVE_BLUE : theme.colors.foregroundMuted, fontSize: 14, flexShrink: 1 },
    }),
    [theme, layout.compact, on, hovered, busy],
  );

  // Hidden until the lookup answers, so it does not flash up in a project that already has one.
  if (projectId === null || existing.isPending) return null;
  if (existing.data?.workspace && !on) return null;

  const toggle = async () => {
    const value = !on;
    setBusy(true);
    try {
      await newWorkspace.setMetadata({ [ROLE_KEY]: value ? ORCHESTRATOR_ROLE : null });
      // The orchestrator coordinates other workspaces; it needs no branch of its own.
      if (value && newWorkspace.isolation === "worktree") await newWorkspace.setIsolation("local");
    } finally {
      setBusy(false);
    }
  };

  const iconColor = on ? ACTIVE_BLUE : active ? theme.colors.foreground : theme.colors.foregroundMuted;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Orchestrator"
      accessibilityState={{ checked: on, disabled: busy }}
      disabled={busy}
      onPress={() => void toggle()}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={styles.button}
    >
      <Icon name={ICON} size={14} color={iconColor} />
      {layout.compact ? (
        <Text style={styles.label} numberOfLines={1}>
          Orchestrator
        </Text>
      ) : null}
    </Pressable>
  );
}
