import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  type AssigneeFilter,
  browseIssuesRpc,
  type Issue,
  type IssueSort,
  listTeamsRpc,
  type StateType,
} from "../shared/browse";
import { pickerPreferences } from "../shared/settings";
import { FilterButton, FilterMenu, type MenuOption } from "./filter-menu";
import { Palette } from "./palette";
import { PriorityIcon, StatusIcon } from "./status-icon";

const STATUSES: { type: StateType; label: string; color: string }[] = [
  { type: "triage", label: "Triage", color: "#FC7840" },
  { type: "backlog", label: "Backlog", color: "#BEC2C8" },
  { type: "unstarted", label: "Todo", color: "#E2E2E2" },
  { type: "started", label: "In progress", color: "#F2C94C" },
  { type: "completed", label: "Done", color: "#5E6AD2" },
  { type: "canceled", label: "Canceled", color: "#95A2B3" },
];
const ASSIGNEES: { value: AssigneeFilter; label: string }[] = [
  { value: "any", label: "Anyone" },
  { value: "me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
];
const SORTS: { value: IssueSort; label: string; short: string }[] = [
  { value: "updated", label: "Recently updated", short: "Updated" },
  { value: "created", label: "Newest", short: "Newest" },
  { value: "priority", label: "Priority", short: "Priority" },
];

type Prefs = { teamId: string | null; stateTypes: StateType[]; assignee: AssigneeFilter; sort: IssueSort };
const DEFAULT_STATES: StateType[] = ["triage", "unstarted", "started"];
const DEFAULT_PREFS: Prefs = { teamId: null, stateTypes: DEFAULT_STATES, assignee: "any", sort: "updated" };
type MenuId = "team" | "status" | "assignee" | "sort";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function sameStates(a: StateType[], b: StateType[]): boolean {
  return a.length === b.length && a.every((type) => b.includes(type));
}

function initials(name: string): string {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

interface PickerProps {
  theme: PluginTheme;
  compact: boolean;
  open: boolean;
  onClose(): void;
  onPick(issue: Issue): void;
}

export function IssuePicker({ theme, compact, open, onClose, onPick }: PickerProps) {
  const browse = useRpc(browseIssuesRpc);
  const listTeams = useRpc(listTeamsRpc);
  const settings = useSettings(pickerPreferences);
  const prefs: Prefs = settings.status === "ready" ? settings.values : DEFAULT_PREFS;
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query.trim(), 250);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [anchors, setAnchors] = useState<Record<MenuId, number>>({ team: 0, status: 0, assignee: 0, sort: 0 });
  const [toolbar, setToolbar] = useState({ width: 0, height: 0 });
  const searchRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setMenu(null);
      return;
    }
    // The composer takes focus back after a toolbar action; focus the search after it does.
    if (compact) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [open, compact]);

  function update(patch: Partial<Prefs>) {
    if (settings.status !== "ready") return;
    void settings.save({ ...settings.values, ...patch }, settings.revision);
  }

  const teams = useQuery({ queryKey: ["teams"], queryFn: () => listTeams({}), enabled: open, staleTime: 5 * 60_000 });
  const issues = useQuery({
    queryKey: ["browse", debouncedQuery, prefs.teamId, prefs.stateTypes, prefs.assignee, prefs.sort],
    queryFn: () => browse({ query: debouncedQuery, ...prefs }),
    enabled: open && settings.status !== "loading",
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const teamList = teams.data?.teams ?? [];
  const teamColors = useMemo(() => new Map(teamList.map((team) => [team.key, team.color])), [teamList]);
  const selectedTeam = teamList.find((team) => team.id === prefs.teamId) ?? null;

  const muted = theme.colors.foregroundMuted;
  const anchor = (id: MenuId) => (x: number) => setAnchors((current) => (current[id] === x ? current : { ...current, [id]: x }));
  const toggleMenu = (id: MenuId) => setMenu((current) => (current === id ? null : id));

  const statusDefault = sameStates(prefs.stateTypes, DEFAULT_STATES);
  const statusValue = (statusDefault
    ? "Open"
    : prefs.stateTypes.length === 0
      ? "Any status"
      : prefs.stateTypes.length === 1
        ? STATUSES.find((status) => status.type === prefs.stateTypes[0])?.label
        : `${prefs.stateTypes.length} statuses`) ?? "Status";

  let menuView: React.ReactNode = null;
  if (menu === "team") {
    const options: MenuOption[] = [
      { key: "all", label: "All teams", selected: prefs.teamId === null, onPress: () => (update({ teamId: null }), setMenu(null)) },
      ...teamList.map((team) => ({
        key: team.id,
        label: `${team.name}`,
        selected: prefs.teamId === team.id,
        leading: <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: team.color ?? muted }} />,
        onPress: () => (update({ teamId: team.id }), setMenu(null)),
      })),
    ];
    menuView = <FilterMenu theme={theme} title="Team" left={anchors.team} top={toolbar.height + 4} boundsWidth={toolbar.width} options={options} />;
  } else if (menu === "status") {
    const options: MenuOption[] = STATUSES.map((status) => {
      const on = prefs.stateTypes.includes(status.type);
      return {
        key: status.type,
        label: status.label,
        selected: on,
        leading: <StatusIcon type={status.type} color={status.color} size={13} />,
        // Multi-select: stays open.
        onPress: () =>
          update({ stateTypes: on ? prefs.stateTypes.filter((type) => type !== status.type) : [...prefs.stateTypes, status.type] }),
      };
    });
    menuView = (
      <FilterMenu
        theme={theme}
        title="Status"
        left={anchors.status} top={toolbar.height + 4} boundsWidth={toolbar.width}
        options={options}
        footer={statusDefault ? undefined : { label: "Reset to open issues", onPress: () => update({ stateTypes: DEFAULT_STATES }) }}
      />
    );
  } else if (menu === "assignee") {
    const options: MenuOption[] = ASSIGNEES.map((option) => ({
      key: option.value,
      label: option.label,
      selected: prefs.assignee === option.value,
      onPress: () => (update({ assignee: option.value }), setMenu(null)),
    }));
    menuView = <FilterMenu theme={theme} title="Assignee" left={anchors.assignee} top={toolbar.height + 4} boundsWidth={toolbar.width} options={options} />;
  } else if (menu === "sort") {
    const options: MenuOption[] = SORTS.map((option) => ({
      key: option.value,
      label: option.label,
      selected: prefs.sort === option.value,
      onPress: () => (update({ sort: option.value }), setMenu(null)),
    }));
    menuView = <FilterMenu theme={theme} title="Sort by" left={anchors.sort} top={toolbar.height + 4} boundsWidth={toolbar.width} options={options} />;
  }

  const list = issues.data?.issues ?? [];
  return (
    <Palette theme={theme} compact={compact} open={open} onClose={onClose}>
        <View style={{ zIndex: 10 }}>
          <View
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setToolbar((current) => (current.width === width && current.height === height ? current : { width, height }));
            }}
            style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", height: 44, marginTop: 8, paddingHorizontal: 12 }}>
              <View style={{ paddingHorizontal: 6 }}>
                <Icon name="Search" size={15} color={muted} />
              </View>
              <TextInput
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                onFocus={() => setMenu(null)}
                placeholder="Search issues"
                placeholderTextColor={muted}
                accessibilityLabel="Search Linear issues"
                autoCorrect={false}
                autoCapitalize="none"
                cursorColor={theme.colors.foreground}
                selectionColor={theme.colors.foreground}
                // No focus ring: the field is the dialog's only input and already reads as active.
                style={{
                  flex: 1,
                  height: 32,
                  color: theme.colors.foreground,
                  fontSize: 14,
                  paddingHorizontal: 2,
                  borderWidth: 0,
                  outlineWidth: 0,
                  outlineColor: "transparent",
                }}
              />
              {issues.isFetching ? <ActivityIndicator size="small" color={muted} style={{ marginRight: 4 }} /> : null}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12 }}
            >
              <FilterButton
                theme={theme}
                icon="Users"
                title="Team"
                value={selectedTeam?.key ?? "All teams"}
                active={selectedTeam !== null}
                open={menu === "team"}
                onPress={() => toggleMenu("team")}
                onLayoutX={anchor("team")}
              />
              <FilterButton
                theme={theme}
                icon="CircleDashed"
                title="Status"
                value={statusValue}
                active={!statusDefault}
                open={menu === "status"}
                onPress={() => toggleMenu("status")}
                onLayoutX={anchor("status")}
              />
              <FilterButton
                theme={theme}
                icon="UserRound"
                title="Assignee"
                value={prefs.assignee === "me" ? "Me" : prefs.assignee === "unassigned" ? "Unassigned" : "Anyone"}
                active={prefs.assignee !== "any"}
                open={menu === "assignee"}
                onPress={() => toggleMenu("assignee")}
                onLayoutX={anchor("assignee")}
              />
              <FilterButton
                theme={theme}
                icon="ArrowUpDown"
                title="Sort"
                value={SORTS.find((sort) => sort.value === prefs.sort)?.short ?? "Updated"}
                active={prefs.sort !== "updated"}
                open={menu === "sort"}
                onPress={() => toggleMenu("sort")}
                onLayoutX={anchor("sort")}
              />
            </ScrollView>
          </View>
          {menuView}
        </View>

        {/* Sized by its rows; the modal grows with it. Room for an open dropdown when the list is short. */}
        <View style={{ minHeight: menu ? 330 : undefined, flexShrink: 1 }}>
          {issues.error ? (
            <Text style={{ color: theme.colors.statusDanger, padding: 16, fontSize: 13 }}>
              {issues.error instanceof Error ? issues.error.message : String(issues.error)}
            </Text>
          ) : issues.isLoading ? (
            <ActivityIndicator style={{ padding: 24 }} color={muted} />
          ) : list.length === 0 ? (
            <Text style={{ color: muted, padding: 16, fontSize: 13 }}>No matching issues</Text>
          ) : (
            <ScrollView
              style={{ maxHeight: compact ? undefined : 420, flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ paddingVertical: 4 }}
              keyboardShouldPersistTaps="handled"
            >
              {list.map((item) => (
                <IssueRow key={item.id} theme={theme} issue={item} teamColor={teamColors.get(item.teamKey) ?? null} onPick={onPick} />
              ))}
            </ScrollView>
          )}
          {menu ? (
            <Pressable
              accessibilityLabel="Close menu"
              onPress={() => setMenu(null)}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            />
          ) : null}
        </View>
    </Palette>
  );
}

const IssueRow = memo(function IssueRow({
  theme,
  issue,
  teamColor,
  onPick,
}: {
  theme: PluginTheme;
  issue: Issue;
  teamColor: string | null;
  onPick(issue: Issue): void;
}) {
  const [hovered, setHovered] = useState(false);
  const muted = theme.colors.foregroundMuted;
  // Hover is tracked on a wrapper: pointerleave does not fire when moving onto the nested link,
  // unlike Pressable's hover-out.
  return (
    <View onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${issue.identifier} ${issue.title}, ${issue.state.name}`}
      accessibilityHint="Uses this issue as the prompt"
      onPress={() => onPick(issue)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingHorizontal: 10,
        marginHorizontal: 4,
        borderRadius: 6,
        backgroundColor: pressed || hovered ? theme.colors.surface1 : "transparent",
      })}
    >
      <View style={{ width: 14, alignItems: "center" }}>
        <PriorityIcon priority={issue.priority} color={issue.priority === 1 ? "#F2994A" : muted} size={13} />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          minWidth: 84,
          height: 20,
          paddingHorizontal: 6,
          borderRadius: 4,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: teamColor ?? muted }} />
        <Text style={{ color: muted, fontSize: 11, fontWeight: "500" }}>{issue.teamKey}</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 11, fontVariant: ["tabular-nums"] }}>{issue.number}</Text>
      </View>
      <StatusIcon type={issue.state.type} color={issue.state.color} size={13} />
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }} numberOfLines={1}>
        {issue.title}
      </Text>
      {hovered ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${issue.identifier} in Linear`}
          onPress={() => void openExternalUrl(issue.url)}
          hitSlop={6}
        >
          <Icon name="ExternalLink" size={13} color={muted} />
        </Pressable>
      ) : null}
      {issue.assignee ? (
        <View
          accessibilityLabel={`Assigned to ${issue.assignee}`}
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Text style={{ color: muted, fontSize: 8, fontWeight: "600" }}>{initials(issue.assignee)}</Text>
        </View>
      ) : (
        <View style={{ width: 18 }} />
      )}
    </Pressable>
    </View>
  );
});
