import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { formatBytes, formatPercent, formatRateShort, levelColor } from "./format";
import { useStats } from "./use-stats";

function makeStyles(theme: PluginTheme) {
  return {
    root: { paddingHorizontal: 12, paddingVertical: 6, gap: 3 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, height: 14 },
    label: { width: 30, color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" as const },
    track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.colors.surface2, overflow: "hidden" as const },
    value: {
      minWidth: 30,
      textAlign: "right" as const,
      color: theme.colors.foreground,
      fontSize: 10,
      fontVariant: ["tabular-nums" as const],
    },
    net: {
      flex: 1,
      textAlign: "right" as const,
      color: theme.colors.foreground,
      fontSize: 10,
      fontVariant: ["tabular-nums" as const],
    },
    muted: { color: theme.colors.foregroundMuted, fontSize: 10 },
  };
}

type Styles = ReturnType<typeof makeStyles>;

function Meter({
  label,
  percent,
  hint,
  theme,
  styles,
}: {
  label: string;
  percent: number;
  hint: string;
  theme: PluginTheme;
  styles: Styles;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color = levelColor(theme, clamped);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label} ${formatPercent(clamped)}, ${hint}`}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View style={{ width: `${clamped}%`, height: "100%", backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={styles.value}>{formatPercent(clamped)}</Text>
    </View>
  );
}

export function SystemMonitorItem({ theme }: PluginSidebarItemProps) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { latest, state } = useStats();

  if (!latest) {
    return (
      <View style={styles.root}>
        <Text style={styles.muted}>
          {state.status === "error" ? "System monitor unavailable" : "Measuring…"}
        </Text>
      </View>
    );
  }

  const { memory, disk, network } = latest;
  return (
    <View style={styles.root}>
      <Meter
        label="CPU"
        percent={latest.cpu}
        hint={`load ${latest.load[0].toFixed(2)}`}
        theme={theme}
        styles={styles}
      />
      <Meter
        label="RAM"
        percent={(memory.used / memory.total) * 100}
        hint={`${formatBytes(memory.used)} of ${formatBytes(memory.total, 0)}`}
        theme={theme}
        styles={styles}
      />
      {disk && (
        <Meter
          label="DISK"
          percent={(disk.used / disk.total) * 100}
          hint={`${formatBytes(disk.total - disk.used)} free`}
          theme={theme}
          styles={styles}
        />
      )}
      {network && (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={`Network download ${formatRateShort(network.rx)} per second, upload ${formatRateShort(network.tx)} per second`}
        >
          <Text style={styles.label}>NET</Text>
          <Text style={styles.net} numberOfLines={1}>
            ↓{formatRateShort(network.rx)}/s ↑{formatRateShort(network.tx)}/s
          </Text>
        </View>
      )}
    </View>
  );
}
