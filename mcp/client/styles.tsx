import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ServerStatus } from "../shared/mcp";

export function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        padding: compact ? 12 : 24,
        gap: compact ? 12 : 16,
        maxWidth: 960,
        width: "100%" as const,
        alignSelf: "center" as const,
      },
      toolbar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      grow: { flex: 1 },
      centered: {
        flex: 1,
        minHeight: 240,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 12,
      },
      text: { color: theme.colors.foreground, fontSize: 14 },
      strong: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      title: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      mono: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "Menlo" },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
      warning: { color: theme.colors.statusWarning, fontSize: 12 },
      section: { gap: 8 },
      sectionHeader: {
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        gap: 8,
        paddingHorizontal: 2,
      },
      sectionTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        letterSpacing: 0.6,
        textTransform: "uppercase" as const,
      },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
      },
      rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
      rowMain: { flex: 1, gap: 2, minWidth: 0 },
      nameLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
      dot: { width: 8, height: 8, borderRadius: 4 },
      badge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      badgeText: { color: theme.colors.foregroundMuted, fontSize: 11 },
      expanded: {
        paddingHorizontal: 12,
        paddingBottom: 12,
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, paddingTop: 10 },
      toolRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 6,
      },
      banner: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.statusWarning,
        backgroundColor: theme.colors.surface1,
      },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      dangerText: { color: DESTRUCTIVE_FOREGROUND, fontSize: 13, fontWeight: "500" as const },
      /** shadcn's destructive variant: solid fill, light content, no border. */
      destructive: { backgroundColor: theme.colors.statusDanger, borderColor: theme.colors.statusDanger },
      input: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontSize: 13,
      },
      textArea: { minHeight: 96, textAlignVertical: "top" as const, fontFamily: "Menlo" },
      field: { gap: 6 },
      segment: {
        flexDirection: "row" as const,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        overflow: "hidden" as const,
        alignSelf: "flex-start" as const,
      },
      segmentItem: { paddingHorizontal: 12, paddingVertical: 6 },
      segmentActive: { backgroundColor: theme.colors.accent },
      empty: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        textAlign: "center" as const,
        padding: 24,
      },
      listItem: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        gap: 2,
      },
      listItemActive: { backgroundColor: theme.colors.surface2 },
      iconButton: {
        width: 28,
        height: 28,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      destructiveIconButton: { backgroundColor: theme.colors.statusDanger },
      dialogBackdrop: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: 16,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
      },
      dialogDismiss: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 },
      dialog: {
        width: "100%" as const,
        maxWidth: 440,
        padding: 24,
        gap: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
      },
      dialogTitle: { color: theme.colors.foreground, fontSize: 17, fontWeight: "600" as const },
      dialogDescription: { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      dialogActions: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 8,
        marginTop: 12,
      },
      switchTrack: {
        width: 34,
        height: 20,
        borderRadius: 10,
        padding: 2,
        justifyContent: "center" as const,
      },
      switchThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.surface0 },
    }),
    [theme, compact],
  );
}

export type Styles = ReturnType<typeof useStyles>;

/** Content on a destructive fill. The theme has no destructive-foreground token; shadcn uses white. */
export const DESTRUCTIVE_FOREGROUND = "#ffffff";

/** shadcn dims filled buttons to 90% on hover; slightly more while pressed. */
export function fillFeedback(state: { pressed: boolean }): { opacity: number } | null {
  if (state.pressed) return { opacity: 0.8 };
  return (state as { hovered?: boolean }).hovered ? { opacity: 0.9 } : null;
}

export function statusColor(theme: PluginTheme, status: ServerStatus): string {
  switch (status) {
    case "connected":
      return theme.colors.statusSuccess;
    case "needs-auth":
    case "pending":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

export const STATUS_LABEL: Record<ServerStatus, string> = {
  connected: "Connected",
  pending: "Connecting",
  "needs-auth": "Needs sign-in",
  failed: "Failed",
  disabled: "Disabled",
  hidden: "Covered by claude.ai",
  unknown: "Unknown",
};

export function Button({
  label,
  onPress,
  tone = "default",
  disabled,
  busy,
  styles,
  theme,
}: {
  label: string;
  onPress(): void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  styles: Styles;
  theme: PluginTheme;
}) {
  const textStyle =
    tone === "primary" ? styles.primaryText : tone === "danger" ? styles.dangerText : styles.buttonText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={(state) => [
        styles.button,
        tone === "primary" && styles.primary,
        tone === "danger" && styles.destructive,
        tone !== "default" && fillFeedback(state),
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {/* Spinner overlays the hidden label so the button keeps its size while busy. */}
      <Text style={[textStyle, busy && { opacity: 0 }]}>{label}</Text>
      {busy ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator
            size="small"
            style={{ transform: [{ scale: 0.7 }] }}
            color={
              tone === "primary"
                ? theme.colors.accentForeground
                : tone === "danger"
                  ? DESTRUCTIVE_FOREGROUND
                  : theme.colors.foregroundMuted
            }
          />
        </View>
      ) : null}
    </Pressable>
  );
}

export function Switch({
  value,
  onValueChange,
  disabled,
  label,
  styles,
  theme,
}: {
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
  label: string;
  styles: Styles;
  theme: PluginTheme;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={6}
      style={[
        styles.switchTrack,
        {
          backgroundColor: value ? theme.colors.accent : theme.colors.surface2,
          alignItems: value ? ("flex-end" as const) : ("flex-start" as const),
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.switchThumb} />
    </Pressable>
  );
}
