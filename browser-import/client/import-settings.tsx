import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  Loading,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  importCookiesRpc,
  listSitesRpc,
  listSourcesRpc,
  restartPaseoRpc,
  type Site,
  type Source,
} from "../shared/import";

type Theme = PluginSurfaceProps["theme"];

/** Rendering hundreds of rows in a settings page is slow; search narrows the rest. */
const VISIBLE_SITES = 150;

function useStyles(theme: Theme, compact: boolean) {
  return useMemo(
    () => ({
      screen: { gap: 16 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      text: { color: theme.colors.foreground, fontSize: 14 },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      toolbar: {
        flexDirection: (compact ? "column" : "row") as "column" | "row",
        alignItems: (compact ? "stretch" : "center") as "stretch" | "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
      },
      search: {
        flex: compact ? undefined : 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontSize: 13,
      },
      site: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      siteName: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
      footer: { paddingHorizontal: 16, paddingVertical: 10 },
      result: {
        padding: 12,
        gap: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
    }),
    [theme, compact],
  );
}
type Styles = ReturnType<typeof useStyles>;

function Button({
  label,
  onPress,
  primary,
  disabled,
  styles,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary && styles.primary, disabled && { opacity: 0.5 }]}
    >
      <Text style={primary ? styles.primaryText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function sourceLabel(source: Source): string {
  return `${source.browser} · ${source.profile} (${source.cookieCount.toLocaleString()} cookies)`;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function SiteRow({
  site,
  selected,
  onToggle,
  theme,
  styles,
}: {
  site: Site;
  selected: boolean;
  onToggle(): void;
  theme: Theme;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={site.site}
      onPress={onToggle}
      style={styles.site}
    >
      <Icon
        name={selected ? "SquareCheck" : "Square"}
        size={16}
        color={selected ? theme.colors.accent : theme.colors.foregroundMuted}
      />
      <Text style={styles.siteName} numberOfLines={1}>
        {site.site}
      </Text>
      <Text style={styles.muted}>{site.count}</Text>
    </Pressable>
  );
}

function SourceImport({
  source,
  theme,
  styles,
}: {
  source: Source;
  theme: Theme;
  styles: Styles;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const listSites = useRpc(listSitesRpc);
  const runImport = useRpc(importCookiesRpc);
  const restartPaseo = useRpc(restartPaseoRpc);
  const restart = useMutation({
    mutationFn: () => restartPaseo({}),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const [search, setSearch] = useState("");
  /** Sites left out; everything else is imported. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [overwrite, setOverwrite] = useState(true);

  useEffect(() => setExcluded(new Set()), [source.id]);

  const sites = useQuery({
    queryKey: ["browser-import", "sites", source.id],
    queryFn: () => listSites({ sourceId: source.id }),
  });

  const all = sites.data?.sites ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = needle ? all.filter((site) => site.site.includes(needle)) : all;
  const selected = all.filter((site) => !excluded.has(site.site));
  const selectedCookies = selected.reduce((sum, site) => sum + site.count, 0);

  const mutation = useMutation({
    mutationFn: () =>
      runImport({
        sourceId: source.id,
        sites: excluded.size === 0 ? null : selected.map((site) => site.site),
        overwrite,
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
    onSuccess: (result) =>
      toast.show(`Imported ${plural(result.imported, "cookie")}.`, { variant: "success" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["browser-import", "sources"] }),
  });

  const setMany = (names: readonly string[], include: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      for (const name of names) {
        if (include) next.delete(name);
        else next.add(name);
      }
      return next;
    });

  const toggle = (name: string) => setMany([name], excluded.has(name));

  return (
    <>
      <SettingsSection title="Import">
        <SettingsCard>
          <SettingsSwitch
            label="Replace existing cookies"
            hint="Overwrite cookies the Paseo browser already has for the same site, name, and path"
            value={overwrite}
            onValueChange={setOverwrite}
          />
          <SettingsRow
            label={`${plural(selected.length, "site")} selected`}
            hint={`${plural(selectedCookies, "cookie")} from ${source.browser} · ${source.profile}. macOS asks to allow Keychain access the first time.`}
          >
            <Button
              label={mutation.isPending ? "Importing…" : "Import"}
              primary
              styles={styles}
              disabled={mutation.isPending || selected.length === 0 || sites.isPending}
              onPress={() => mutation.mutate()}
            />
          </SettingsRow>
        </SettingsCard>
        {mutation.data ? (
          <View style={styles.result}>
            <Text style={styles.text}>
              Imported {plural(mutation.data.imported, "cookie")}
              {mutation.data.kept ? `, kept ${mutation.data.kept.toLocaleString()} existing` : ""}
              {mutation.data.failed
                ? `, ${mutation.data.failed.toLocaleString()} could not be decrypted`
                : ""}
              .
            </Text>
            <Text style={styles.muted}>
              Restart Paseo to use them. The browser reads its cookie store only when it starts.
              Restarting stops running agents.
            </Text>
            <View style={styles.buttons}>
              <Button
                label={restart.isPending || restart.isSuccess ? "Restarting…" : "Restart Paseo"}
                primary
                styles={styles}
                disabled={restart.isPending || restart.isSuccess}
                onPress={() => restart.mutate()}
              />
            </View>
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Sites"
        info={
          <Text style={styles.muted}>
            Choose which sites to bring over. Cookies are grouped by site, so google.com includes
            mail.google.com and accounts.google.com.
          </Text>
        }
      >
        <SettingsCard>
          {sites.isPending ? (
            <Loading />
          ) : sites.isError ? (
            <View style={styles.footer}>
              <Text style={styles.error}>Could not read cookies: {String(sites.error)}</Text>
            </View>
          ) : (
            <>
              <View style={styles.toolbar}>
                <TextInput
                  accessibilityLabel="Search sites"
                  placeholder={`Search ${plural(all.length, "site")}`}
                  placeholderTextColor={theme.colors.foregroundMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={search}
                  onChangeText={setSearch}
                  style={styles.search}
                />
                <View style={styles.buttons}>
                  <Button
                    label={needle ? "Select matches" : "Select all"}
                    styles={styles}
                    onPress={() => setMany(filtered.map((site) => site.site), true)}
                  />
                  <Button
                    label={needle ? "Clear matches" : "Select none"}
                    styles={styles}
                    onPress={() => setMany(filtered.map((site) => site.site), false)}
                  />
                </View>
              </View>
              {filtered.slice(0, VISIBLE_SITES).map((site) => (
                <SiteRow
                  key={site.site}
                  site={site}
                  selected={!excluded.has(site.site)}
                  onToggle={() => toggle(site.site)}
                  theme={theme}
                  styles={styles}
                />
              ))}
              {filtered.length > VISIBLE_SITES ? (
                <View style={styles.footer}>
                  <Text style={styles.muted}>
                    {plural(filtered.length - VISIBLE_SITES, "more site")} not shown. Search to
                    find them; Select all includes them.
                  </Text>
                </View>
              ) : null}
              {filtered.length === 0 ? (
                <View style={styles.footer}>
                  <Text style={styles.muted}>No sites match.</Text>
                </View>
              ) : null}
            </>
          )}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

export function ImportSettings({ theme, layout }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const listSources = useRpc(listSourcesRpc);
  const sources = useQuery({
    queryKey: ["browser-import", "sources"],
    queryFn: () => listSources({}),
  });
  const [sourceId, setSourceId] = useState<string | null>(null);

  if (sources.isPending) return <Loading />;
  if (sources.isError) {
    return <Text style={styles.error}>Could not look for browsers: {String(sources.error)}</Text>;
  }
  const { unsupported, target, sources: available } = sources.data;
  const source = available.find((candidate) => candidate.id === sourceId) ?? available[0] ?? null;

  return (
    <View style={styles.screen}>
      <SettingsSection
        title="Browser profile"
        info={
          <Text style={styles.muted}>
            Copies cookies from a browser on this Mac into the Paseo browser, so you and your agents
            stay signed in to the sites you already use. Agents with browser tools can also
            use these sessions.
          </Text>
        }
      >
        <SettingsCard>
          {unsupported ? (
            <SettingsRow label="Unavailable" hint={unsupported} />
          ) : available.length === 0 ? (
            <SettingsRow
              label="No browsers found"
              hint="Supported: Chrome, Arc, Dia, Brave, Edge, Vivaldi, Opera, Comet, Ardia, and Chromium"
            />
          ) : (
            <SettingsSelect
              label="Import from"
              value={source!.id}
              options={available.map((candidate) => ({
                label: sourceLabel(candidate),
                value: candidate.id,
              }))}
              onValueChange={setSourceId}
            />
          )}
          {target ? (
            <SettingsRow
              label="Paseo browser"
              hint={`${plural(target.cookieCount, "cookie")} stored`}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      {!unsupported && source ? (
        <SourceImport source={source} theme={theme} styles={styles} />
      ) : null}
    </View>
  );
}
