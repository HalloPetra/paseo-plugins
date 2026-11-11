import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { releaseNow, type Activity } from "../shared/keep-awake";
import { ThemedSwitch } from "./switch";
import {
  formatCountdown,
  iconFor,
  summary,
  useCountdown,
  useKeepAwakeSettings,
  useStatus,
} from "./use-status";

/** Agents shown in the hover list before collapsing into "+N more". */
const MAX_LISTED = 12;
/** Grace before the hover card closes, so brief pointer slips across edges don't dismiss it. */
const HOVER_CLOSE_DELAY_MS = 150;

/**
 * Hover state for the row and its card. Uses pointer enter/leave on a plain View rather than
 * Pressable hover: on web, a Pressable ends its hover whenever the pointer moves onto a nested
 * Pressable (the label, the "Now" link, the switch), which made the card flicker shut.
 */
function useHoverWithDelay() {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return {
    hovered,
    onPointerEnter: () => {
      clear();
      setHovered(true);
    },
    onPointerLeave: () => {
      clear();
      timer.current = setTimeout(() => setHovered(false), HOVER_CLOSE_DELAY_MS);
    },
  };
}

function makeStyles(theme: PluginTheme) {
  return {
    root: { paddingHorizontal: 12, paddingVertical: 6, gap: 2 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, minHeight: 24 },
    main: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    label: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
    link: { color: theme.colors.foregroundMuted, fontSize: 11, textDecorationLine: "underline" as const },
    error: { paddingLeft: 26, color: theme.colors.statusDanger, fontSize: 11 },
    // Opens upward: the row sits at the bottom of the sidebar. The bottom padding is the gap to the
    // row; as padding rather than margin it stays inside the hover area while the pointer crosses.
    hoverCardAnchor: {
      position: "absolute" as const,
      left: 4,
      right: 4,
      bottom: "100%" as const,
      paddingBottom: 4,
      zIndex: 1000,
    },
    hoverCard: {
      padding: 8,
      gap: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
      shadowColor: "rgba(0, 0, 0, 0.35)",
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      shadowOpacity: 1,
      elevation: 8,
    },
    popover: { padding: 12, gap: 6, minWidth: 260 },
    heading: {
      color: theme.colors.foregroundMuted,
      fontSize: 11,
      fontWeight: "600" as const,
      paddingHorizontal: 2,
      paddingBottom: 2,
    },
    list: { gap: 4 },
    item: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: theme.colors.surface2,
    },
    itemTitle: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
    itemKind: { color: theme.colors.foregroundMuted, fontSize: 11 },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
  };
}

type Styles = ReturnType<typeof makeStyles>;

function kindLabel(item: Activity): string | null {
  if (item.kind === "child") return "Subagent";
  if (item.kind === "background") return `${item.count} in background`;
  return null;
}

/** Plain running agents get no icon; only subagents and background work are marked. */
/** The workspace's title, which names the work better than the agent's first prompt. */
function ActivityTitle({ item, styles }: { item: Activity; styles: Styles }) {
  const workspaceTitle = useWorkspace(item.workspaceId ?? "", (workspace) => workspace.title?.trim() || workspace.name);
  return (
    <Text style={styles.itemTitle} numberOfLines={1}>
      {(item.workspaceId && workspaceTitle) || item.title}
    </Text>
  );
}

const KIND_ICON: Record<Activity["kind"], string | null> = {
  agent: null,
  child: "GitFork",
  background: "Layers",
};

function ActivityList({ activity, styles, theme }: { activity: Activity[]; styles: Styles; theme: PluginTheme }) {
  return (
    <>
      <Text style={styles.heading}>Keeping the host awake</Text>
      <View style={styles.list}>
        {activity.slice(0, MAX_LISTED).map((item) => {
          const kind = kindLabel(item);
          return (
            <View key={item.agentId} style={styles.item}>
              {KIND_ICON[item.kind] ? (
                <Icon name={KIND_ICON[item.kind]!} size={14} color={theme.colors.foregroundMuted} />
              ) : null}
              <ActivityTitle item={item} styles={styles} />
              {kind ? (
                <View style={styles.badge}>
                  <Text style={styles.itemKind}>{kind}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {activity.length > MAX_LISTED ? (
        <Text style={[styles.itemKind, { paddingHorizontal: 2 }]}>+{activity.length - MAX_LISTED} more</Text>
      ) : null}
    </>
  );
}

/** The agent list as a bottom sheet, for touch layouts that have no hover. */
function ActivityPopover({ theme }: PluginPopoverProps) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { status } = useStatus();
  const activity = status?.activity ?? [];
  return (
    <View style={styles.popover}>
      {activity.length > 0 ? (
        <ActivityList activity={activity} styles={styles} theme={theme} />
      ) : (
        <Text style={styles.itemKind}>No agents are keeping the host awake.</Text>
      )}
    </View>
  );
}

/**
 * One compact sidebar row: state icon, status with the agent count, and an on/off switch.
 * Hovering the row lists the agents keeping the host awake. Pressing the status opens the
 * settings on desktop and the agent list on touch layouts.
 */
export function createSidebarItem(openSettings: () => void) {
  return function KeepAwakeItem({ theme, layout, openPopover }: PluginSidebarItemProps) {
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { hovered, onPointerEnter, onPointerLeave } = useHoverWithDelay();
    const { status, releaseAt } = useStatus();
    const countdown = useCountdown(releaseAt);
    const { settings, update } = useKeepAwakeSettings();
    const release = useRpc(releaseNow);
    const enabled = settings.status === "ready" ? settings.values.enabled : (status?.enabled ?? false);
    const activity = enabled ? (status?.activity ?? []) : [];
    const inGrace = Boolean(status?.holding && activity.length === 0 && countdown !== null);
    const label = inGrace && countdown !== null ? `Sleep in ${formatCountdown(countdown)}` : summary(status, countdown);

    return (
      <View
        // Tracks hover for the row and the card together: the card is a child, so moving the pointer
        // from the row onto it does not count as leaving.
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        style={[styles.root, { zIndex: hovered ? 1000 : 0 }]}
      >
        {hovered && !layout.compact && activity.length > 0 ? (
          <View style={styles.hoverCardAnchor}>
            <View style={styles.hoverCard}>
              <ActivityList activity={activity} styles={styles} theme={theme} />
            </View>
          </View>
        ) : null}
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={layout.compact ? `${label}. Show agents` : `${label}. Open keep awake settings`}
            style={styles.main}
            onPress={() => (layout.compact ? openPopover(ActivityPopover) : openSettings())}
          >
            <Icon name={iconFor(status)} size={18} color={theme.colors.foregroundMuted} />
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
          {inGrace ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Allow sleep now"
              onPress={() => void release({}).catch(() => {})}
            >
              <Text style={styles.link}>Now</Text>
            </Pressable>
          ) : null}
          <ThemedSwitch
            theme={theme}
            compact={layout.compact}
            accessibilityLabel="Keep host awake while agents run"
            value={enabled}
            disabled={settings.status !== "ready" || settings.saving || status?.supported === false}
            onValueChange={(value) => update({ enabled: value })}
          />
        </View>
        {status?.error ? (
          <Text style={styles.error} numberOfLines={2}>
            {status.error}
          </Text>
        ) : null}
      </View>
    );
  };
}
