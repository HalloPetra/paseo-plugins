import { openExternalUrl, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { getHistory, recordOpened, rememberOpenBrowser, subscribe, takePendingOpen } from "./pending";
import { useReportTheme } from "./theme-reporter";

/**
 * Plugins can open the Paseo browser only from a panel or screen. Until one has mounted, the
 * link popover queues the URL and opens this panel in the Explorer; the panel opens the browser
 * tab and hands its opener to the popover for later clicks. It also lists the links opened in
 * this workspace.
 */
export function LinksPanel({ workspaceId, navigation, revision, theme, layout }: PluginWorkspacePanelProps) {
  useReportTheme(theme);
  const openBrowser = navigation?.openBrowser;
  const [error, setError] = useState<string | null>(null);
  const history = useSyncExternalStore(subscribe, () => getHistory(workspaceId));

  useEffect(() => rememberOpenBrowser(openBrowser), [openBrowser]);

  // `revision` changes every time the popover reopens this panel, even when its tab is open.
  useEffect(() => {
    const url = takePendingOpen(workspaceId);
    if (!url) return;
    if (!openBrowser) {
      setError("The Paseo browser is only available in the desktop app.");
      return;
    }
    try {
      openBrowser({ url, workspaceId });
      recordOpened(workspaceId, url);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [revision, workspaceId, openBrowser]);

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 20, gap: 12 },
      title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      url: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      action: {
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      actionText: { color: theme.colors.foreground, fontSize: 12 },
    }),
    [theme, layout.compact],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Links</Text>
      <Text style={styles.hint}>
        Click a link in an agent chat to choose where it opens. ⌘-click opens it in the system
        browser directly.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {history.length === 0 ? (
        <Text style={styles.hint}>Links you open in the Paseo browser appear here.</Text>
      ) : (
        history.map((entry) => (
          <View key={entry.url} style={styles.row}>
            <Text style={styles.url} numberOfLines={1}>
              {entry.url}
            </Text>
            {openBrowser ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${entry.url} in the Paseo browser`}
                style={styles.action}
                onPress={() => {
                  try {
                    openBrowser({ url: entry.url, workspaceId });
                    recordOpened(workspaceId, entry.url);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                  }
                }}
              >
                <Text style={styles.actionText}>Paseo</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${entry.url} in the system browser`}
              style={styles.action}
              onPress={() => {
                openExternalUrl(entry.url).catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                );
              }}
            >
              <Text style={styles.actionText}>System</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
