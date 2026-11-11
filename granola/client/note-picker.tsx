import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { browseNotesRpc, type Folder, listLocationsRpc, listPeopleRpc, type NoteSummary } from "../shared/notes";
import { type DateRange, type NoteSort, pickerPreferences } from "../shared/settings";
import { FilterButton, FilterMenu, type MenuOption } from "./filter-menu";
import { Palette } from "./palette";

const RANGES: { value: DateRange; label: string; short: string }[] = [
  { value: "week", label: "Last 7 days", short: "7 days" },
  { value: "month", label: "Last 30 days", short: "30 days" },
  { value: "quarter", label: "Last 90 days", short: "90 days" },
  { value: "any", label: "Any time", short: "Any time" },
];
const SORTS: { value: NoteSort; label: string; short: string }[] = [
  { value: "newest", label: "Newest meetings", short: "Newest" },
  { value: "oldest", label: "Oldest meetings", short: "Oldest" },
  { value: "updated", label: "Recently updated", short: "Updated" },
];

type Participant = { email: string; name: string | null };
type Prefs = { range: DateRange; spaceId: string | null; folderId: string | null; sort: NoteSort; participant: Participant | null };
const DEFAULT_PREFS: Prefs = { range: "month", spaceId: null, folderId: null, sort: "newest", participant: null };
type MenuId = "space" | "folder" | "participant" | "range" | "sort";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // 24-hour HH:MM in local time, built by hand so every platform's Intl gives the same result.
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function initials(name: string): string {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Folders in tree order with their depth, limited to one space when given. */
function folderTree(folders: Folder[], spaceId: string | null): { folder: Folder; depth: number }[] {
  const scoped = spaceId ? folders.filter((folder) => folder.spaceId === spaceId) : folders;
  const ids = new Set(scoped.map((folder) => folder.id));
  const children = new Map<string | null, Folder[]>();
  for (const folder of scoped) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  const out: { folder: Folder; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const folder of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

interface PickerProps {
  theme: PluginTheme;
  compact: boolean;
  open: boolean;
  /** Note whose transcript is being fetched after a pick. */
  loadingId: string | null;
  pickError: string | null;
  onClose(): void;
  onPick(note: NoteSummary): void;
}

export function NotePicker({ theme, compact, open, loadingId, pickError, onClose, onPick }: PickerProps) {
  const browse = useRpc(browseNotesRpc);
  const listLocations = useRpc(listLocationsRpc);
  const listPeople = useRpc(listPeopleRpc);
  const settings = useSettings(pickerPreferences);
  const prefs: Prefs = settings.status === "ready" ? settings.values : DEFAULT_PREFS;
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query.trim(), 250);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [anchors, setAnchors] = useState<Record<MenuId, number>>({ space: 0, folder: 0, participant: 0, range: 0, sort: 0 });
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

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocations({}),
    enabled: open,
    // The daemon keeps a saved copy and refreshes it; within a session one fetch is enough.
    staleTime: 30 * 60_000,
  });
  // Loaded with the picker so the menu opens ready; the daemon caches attendees per meeting on disk.
  const people = useQuery({
    queryKey: ["people", prefs.range, prefs.spaceId, prefs.folderId],
    queryFn: () => listPeople({ range: prefs.range, spaceId: prefs.spaceId, folderId: prefs.folderId }),
    enabled: open,
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
  });
  const participantEmail = prefs.participant?.email ?? "";
  const notes = useQuery({
    queryKey: ["browse", debouncedQuery, participantEmail, prefs.range, prefs.spaceId, prefs.folderId, prefs.sort],
    queryFn: () =>
      browse({
        query: debouncedQuery,
        participant: participantEmail,
        range: prefs.range,
        spaceId: prefs.spaceId,
        folderId: prefs.folderId,
        sort: prefs.sort,
      }),
    enabled: open && settings.status !== "loading",
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const spaces = locations.data?.spaces ?? [];
  const folders = locations.data?.folders ?? [];
  const tree = useMemo(() => folderTree(folders, prefs.spaceId), [folders, prefs.spaceId]);
  const selectedSpace = spaces.find((space) => space.id === prefs.spaceId) ?? null;
  const selectedFolder = folders.find((folder) => folder.id === prefs.folderId) ?? null;

  const muted = theme.colors.foregroundMuted;
  const anchor = (id: MenuId) => (x: number) => setAnchors((current) => (current[id] === x ? current : { ...current, [id]: x }));
  const toggleMenu = (id: MenuId) => setMenu((current) => (current === id ? null : id));
  const menuProps = (id: MenuId) => ({ theme, left: anchors[id], top: toolbar.height + 4, boundsWidth: toolbar.width });

  let menuView: React.ReactNode = null;
  if (menu === "space") {
    const options: MenuOption[] = [
      { key: "all", label: "All spaces", selected: prefs.spaceId === null, onPress: () => (update({ spaceId: null }), setMenu(null)) },
      ...spaces.map((space) => ({
        key: space.id,
        label: space.name,
        selected: prefs.spaceId === space.id,
        onPress: () => {
          // A folder from another space would match nothing.
          const keepFolder = selectedFolder?.spaceId === space.id;
          update({ spaceId: space.id, folderId: keepFolder ? prefs.folderId : null });
          setMenu(null);
        },
      })),
    ];
    menuView = <FilterMenu {...menuProps("space")} title="Space" options={options} />;
  } else if (menu === "folder") {
    const options: MenuOption[] = [
      { key: "all", label: "All folders", selected: prefs.folderId === null, onPress: () => (update({ folderId: null }), setMenu(null)) },
      ...tree.map(({ folder, depth }) => ({
        key: folder.id,
        label: folder.name,
        selected: prefs.folderId === folder.id,
        leading: (
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: depth * 12 }}>
            <Icon name="Folder" size={13} color={muted} />
          </View>
        ),
        onPress: () => (update({ folderId: folder.id }), setMenu(null)),
      })),
    ];
    menuView = <FilterMenu {...menuProps("folder")} title="Folder (includes subfolders)" options={options} />;
  } else if (menu === "participant") {
    const list = people.data?.people ?? [];
    const selected = prefs.participant;
    const avatar = (label: string) => (
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ color: muted, fontSize: 8, fontWeight: "600" }}>{initials(label)}</Text>
      </View>
    );
    const options: MenuOption[] = [
      {
        key: "anyone",
        label: "Anyone",
        selected: selected === null,
        onPress: () => (update({ participant: null }), setMenu(null)),
      },
      // Keep the current choice visible even when it is not among recent meetings.
      ...(selected && !list.some((person) => person.email.toLowerCase() === selected.email.toLowerCase())
        ? [{ email: selected.email, name: selected.name, meetings: 0 }]
        : []
      ).concat(list).map((person) => {
        const label = person.name ?? person.email;
        return {
          key: person.email,
          label,
          selected: selected?.email.toLowerCase() === person.email.toLowerCase(),
          leading: avatar(label),
          onPress: () => (update({ participant: { email: person.email, name: person.name } }), setMenu(null)),
        };
      }),
    ];
    menuView = (
      <FilterMenu
        {...menuProps("participant")}
        title="Team member"
        options={options}
        header={
          people.isLoading ? (
            <ActivityIndicator size="small" color={muted} style={{ paddingVertical: 8 }} />
          ) : people.error ? (
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12, paddingHorizontal: 10, paddingBottom: 4 }}>
              {errorText(people.error)}
            </Text>
          ) : null
        }
      />
    );
  } else if (menu === "range") {
    const options: MenuOption[] = RANGES.map((option) => ({
      key: option.value,
      label: option.label,
      selected: prefs.range === option.value,
      onPress: () => (update({ range: option.value }), setMenu(null)),
    }));
    menuView = <FilterMenu {...menuProps("range")} title="Meeting date" options={options} />;
  } else if (menu === "sort") {
    const options: MenuOption[] = SORTS.map((option) => ({
      key: option.value,
      label: option.label,
      selected: prefs.sort === option.value,
      onPress: () => (update({ sort: option.value }), setMenu(null)),
    }));
    menuView = <FilterMenu {...menuProps("sort")} title="Sort by" options={options} />;
  }

  const list = notes.data?.notes ?? [];
  const filtered = Boolean(debouncedQuery || prefs.participant || prefs.spaceId || prefs.folderId);
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
              placeholder="Search meeting titles and summaries"
              placeholderTextColor={muted}
              accessibilityLabel="Search Granola meetings"
              autoCorrect={false}
              autoCapitalize="none"
              cursorColor={theme.colors.foreground}
              selectionColor={theme.colors.foreground}
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
            {notes.isFetching ? <ActivityIndicator size="small" color={muted} style={{ marginRight: 4 }} /> : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12 }}
          >
            {spaces.length > 0 ? (
              <FilterButton
                theme={theme}
                icon="LayoutGrid"
                title="Space"
                value={selectedSpace?.name ?? "All spaces"}
                active={selectedSpace !== null}
                open={menu === "space"}
                onPress={() => toggleMenu("space")}
                onLayoutX={anchor("space")}
              />
            ) : null}
            {folders.length > 0 ? (
              <FilterButton
                theme={theme}
                icon="Folder"
                title="Folder"
                value={selectedFolder?.name ?? "All folders"}
                active={selectedFolder !== null}
                open={menu === "folder"}
                onPress={() => toggleMenu("folder")}
                onLayoutX={anchor("folder")}
              />
            ) : null}
            <FilterButton
              theme={theme}
              icon="UsersRound"
              title="Participant"
              value={prefs.participant ? (prefs.participant.name ?? prefs.participant.email) : "Anyone"}
              active={prefs.participant !== null}
              open={menu === "participant"}
              onPress={() => toggleMenu("participant")}
              onLayoutX={anchor("participant")}
            />
            <FilterButton
              theme={theme}
              icon="Calendar"
              title="Date"
              value={RANGES.find((option) => option.value === prefs.range)?.short ?? "30 days"}
              active={prefs.range !== DEFAULT_PREFS.range}
              open={menu === "range"}
              onPress={() => toggleMenu("range")}
              onLayoutX={anchor("range")}
            />
            <FilterButton
              theme={theme}
              icon="ArrowUpDown"
              title="Sort"
              value={SORTS.find((option) => option.value === prefs.sort)?.short ?? "Newest"}
              active={prefs.sort !== DEFAULT_PREFS.sort}
              open={menu === "sort"}
              onPress={() => toggleMenu("sort")}
              onLayoutX={anchor("sort")}
            />
          </ScrollView>
        </View>
        {menuView}
      </View>

      {pickError ? (
        <Text style={{ color: theme.colors.statusDanger, paddingHorizontal: 16, paddingTop: 10, fontSize: 13 }}>{pickError}</Text>
      ) : null}

      {/* Sized by its rows; the modal grows with it. Room for an open dropdown when the list is short. */}
      <View style={{ minHeight: menu ? 330 : undefined, flexShrink: 1 }}>
        {notes.error ? (
          <Text style={{ color: theme.colors.statusDanger, padding: 16, fontSize: 13 }}>{errorText(notes.error)}</Text>
        ) : notes.isLoading ? (
          <ActivityIndicator style={{ padding: 24 }} color={muted} />
        ) : list.length === 0 ? (
          <Text style={{ color: muted, padding: 16, fontSize: 13 }}>{filtered ? "No matching meetings" : "No meetings in this range"}</Text>
        ) : (
          <ScrollView
            style={{ maxHeight: compact ? undefined : 420, flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingVertical: 4 }}
            keyboardShouldPersistTaps="handled"
          >
            {list.map((note) => (
              <NoteRow
                key={note.id}
                theme={theme}
                note={note}
                loading={loadingId === note.id}
                disabled={loadingId !== null}
                onPick={onPick}
              />
            ))}
            {notes.data?.truncated || notes.data?.titleOnly ? (
              <Text style={{ color: muted, paddingHorizontal: 14, paddingVertical: 8, fontSize: 12 }}>
                {notes.data.titleOnly
                  ? "Search is unavailable for this API key, so only titles and owners are matched."
                  : "Showing the first matches. Narrow the search or filters to find others."}
              </Text>
            ) : null}
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

const NoteRow = memo(function NoteRow({
  theme,
  note,
  loading,
  disabled,
  onPick,
}: {
  theme: PluginTheme;
  note: NoteSummary;
  loading: boolean;
  disabled: boolean;
  onPick(note: NoteSummary): void;
}) {
  const muted = theme.colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${note.title}, ${formatDate(note.meetingAt)}`}
      accessibilityHint="Attaches this meeting's transcript"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={() => onPick(note)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 34,
        paddingHorizontal: 10,
        marginHorizontal: 4,
        borderRadius: 6,
        opacity: disabled && !loading ? 0.5 : 1,
        backgroundColor: pressed || hovered || loading ? theme.colors.surface1 : "transparent",
      })}
    >
      <View
        style={{
          minWidth: 64,
          height: 20,
          paddingHorizontal: 6,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          {formatDate(note.meetingAt)}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ color: muted, fontSize: 11, minWidth: 34, flexShrink: 0, fontVariant: ["tabular-nums"] }}>
        {formatTime(note.meetingAt)}
      </Text>
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }} numberOfLines={1}>
        {note.title}
      </Text>
      {loading ? (
        <ActivityIndicator size="small" color={muted} />
      ) : note.owner ? (
        <Text style={{ color: muted, fontSize: 12, maxWidth: 140 }} numberOfLines={1}>
          {note.owner}
        </Text>
      ) : null}
    </Pressable>
  );
});
