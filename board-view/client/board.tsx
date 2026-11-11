import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PaseoWorkspace } from "@getpaseo/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useOpenWorkspaces } from "./use-workspaces";

type Status = PaseoWorkspace["status"];

// Columns follow a workspace's lifecycle left to right: it starts Working, may get
// stuck (Needs input / Failed) and bounce back, then lands in Ready to review and Done.
// Labels match Paseo's sidebar "Group by status" view.
const COLUMNS: ReadonlyArray<{ status: Status; title: string }> = [
  { status: "running", title: "Working" },
  { status: "needs_input", title: "Needs input" },
  { status: "failed", title: "Failed" },
  { status: "attention", title: "Ready to review" },
  { status: "done", title: "Done" },
];

function statusColor(theme: PluginTheme, status: Status): string {
  switch (status) {
    case "needs_input":
    case "attention":
      return theme.colors.statusWarning;
    case "running":
      return theme.colors.accent;
    case "failed":
      return theme.colors.statusDanger;
    case "done":
      return theme.colors.statusSuccess;
  }
}

function relativeTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sortKey(workspace: PaseoWorkspace): number {
  const iso = workspace.statusEnteredAt ?? workspace.activityAt ?? workspace.createdAt;
  const value = iso ? Date.parse(iso) : 0;
  return Number.isFinite(value) ? value : 0;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function BoardScreen({ theme, layout, host, navigation }: PluginScreenProps) {
  const state = useOpenWorkspaces();
  const now = useNow(30_000);
  const compact = layout.compact;

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      board: { padding: compact ? 12 : 16, gap: compact ? 12 : 16 },
      column: {
        width: compact ? undefined : 280,
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        gap: 8,
      },
      columnHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingBottom: 4 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      columnTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const, flex: 1 },
      count: { color: theme.colors.foregroundMuted, fontSize: 12 },
      card: {
        backgroundColor: theme.colors.surface0,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        gap: 4,
      },
      cardPressed: { backgroundColor: theme.colors.surface2 },
      cardTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      cardMeta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      metaRow: { flexDirection: "row" as const, gap: 8, flexWrap: "wrap" as const },
      additions: { color: theme.colors.statusSuccess, fontSize: 12 },
      deletions: { color: theme.colors.statusDanger, fontSize: 12 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 12, paddingVertical: 8, textAlign: "center" as const },
      message: { color: theme.colors.foregroundMuted, fontSize: 14, padding: 24 },
    }),
    [theme, compact],
  );

  if (state.kind === "loading") {
    return (
      <View style={styles.screen}>
        <Text style={styles.message}>Loading workspaces…</Text>
      </View>
    );
  }
  if (state.kind === "error") {
    return (
      <View style={styles.screen}>
        <Text style={[styles.message, { color: theme.colors.statusDanger }]}>
          Could not load workspaces: {state.message}
        </Text>
      </View>
    );
  }

  const groups = new Map<Status, PaseoWorkspace[]>(COLUMNS.map((c) => [c.status, []]));
  for (const workspace of state.workspaces.values()) {
    if (workspace.archivingAt || workspace.internal || workspace.background) continue;
    groups.get(workspace.status)?.push(workspace);
  }
  for (const list of groups.values()) list.sort((a, b) => sortKey(b) - sortKey(a));

  const columns = COLUMNS.map(({ status, title }) => {
    const items = groups.get(status) ?? [];
    return (
      <View key={status} style={styles.column}>
        <View style={styles.columnHeader}>
          <View style={[styles.dot, { backgroundColor: statusColor(theme, status) }]} />
          <Text style={styles.columnTitle}>{title}</Text>
          <Text style={styles.count}>{items.length}</Text>
        </View>
        {items.length === 0 ? <Text style={styles.empty}>No workspaces</Text> : null}
        {items.map((workspace) => {
          const label = workspace.title || workspace.name;
          const branch = workspace.gitRuntime?.currentBranch;
          const since = relativeTime(workspace.statusEnteredAt ?? workspace.activityAt, now);
          const diff = workspace.diffStat;
          const pr = workspace.githubRuntime?.pullRequest;
          const open = navigation
            ? () => navigation.openWorkspace({ workspaceId: workspace.id, serverId: host.id })
            : undefined;
          return (
            <Pressable
              key={workspace.id}
              accessibilityRole="button"
              accessibilityLabel={`Open workspace ${label}, ${title}`}
              disabled={!open}
              onPress={open}
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            >
              <Text style={styles.cardTitle} numberOfLines={2}>
                {label}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {workspace.projectCustomName || workspace.projectDisplayName}
                {branch && branch !== label ? ` · ${branch}` : ""}
              </Text>
              <View style={styles.metaRow}>
                {since ? <Text style={styles.cardMeta}>{since}</Text> : null}
                {diff && (diff.additions > 0 || diff.deletions > 0) ? (
                  <>
                    <Text style={styles.additions}>+{diff.additions}</Text>
                    <Text style={styles.deletions}>−{diff.deletions}</Text>
                  </>
                ) : null}
                {pr?.number ? (
                  <Text style={styles.cardMeta}>
                    PR #{pr.number}
                    {pr.isMerged ? " merged" : pr.isDraft ? " draft" : ""}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  });

  // Wide: columns side by side, scroll horizontally; each column scrolls vertically.
  // Compact: columns stacked in one vertical scroll.
  if (compact) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.board}>
        {columns}
      </ScrollView>
    );
  }
  return (
    <ScrollView
      horizontal
      style={styles.screen}
      contentContainerStyle={[styles.board, { flexDirection: "row", alignItems: "flex-start" }]}
    >
      {columns.map((column, index) => (
        <ScrollView key={COLUMNS[index].status} style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
          {column}
        </ScrollView>
      ))}
    </ScrollView>
  );
}
