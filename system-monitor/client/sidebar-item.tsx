import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { HISTORY_LENGTH, type Sample } from "../shared/stats";
import { formatBytes, formatPercent, formatRateShort, levelColor } from "./format";
import { useStats } from "./use-stats";

const CHART_HEIGHT = 14;
const NET_HEIGHT = 20;

function makeStyles(theme: PluginTheme) {
  const value = {
    width: 38,
    textAlign: "right" as const,
    color: theme.colors.foreground,
    fontSize: 10,
    fontVariant: ["tabular-nums" as const],
  };
  return {
    root: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    label: { width: 30, color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" as const },
    chart: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "flex-end" as const,
      gap: 1,
      overflow: "hidden" as const,
    },
    value,
    netValue: { ...value, fontSize: 9, lineHeight: 10 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 10 },
    baseline: { position: "absolute" as const, left: 0, right: 0, height: 1, backgroundColor: theme.colors.border },
  };
}

type Styles = ReturnType<typeof makeStyles>;

/** Left-pads with nulls so the chart fills from the right as history accumulates. */
function padded<T>(values: T[]): (T | null)[] {
  return [...Array<null>(Math.max(0, HISTORY_LENGTH - values.length)).fill(null), ...values.slice(-HISTORY_LENGTH)];
}

/** Percentage history; each bar takes the level color of its own value. */
function PercentChart({ values, theme, styles }: { values: number[]; theme: PluginTheme; styles: Styles }) {
  return (
    <View style={[styles.chart, { height: CHART_HEIGHT }]}>
      <View style={[styles.baseline, { bottom: 0 }]} />
      {padded(values).map((value, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: value === null ? 0 : Math.max(1, (Math.min(100, value) / 100) * CHART_HEIGHT),
            backgroundColor: value === null ? "transparent" : levelColor(theme, value),
            borderTopLeftRadius: 1,
            borderTopRightRadius: 1,
          }}
        />
      ))}
    </View>
  );
}

/** Download above the midline, upload below, both on one scale. */
function NetworkChart({ samples, theme, styles }: { samples: Sample[]; theme: PluginTheme; styles: Styles }) {
  const points = padded(samples.map((sample) => sample.network));
  const max = Math.max(1, ...samples.flatMap((s) => (s.network ? [s.network.rx, s.network.tx] : [])));
  const half = NET_HEIGHT / 2;
  const bar = (rate: number) => (rate <= 0 ? 0 : Math.max(1, (rate / max) * half));
  return (
    <View style={[styles.chart, { height: NET_HEIGHT, alignItems: "stretch" }]}>
      <View style={[styles.baseline, { top: half }]} />
      {points.map((point, index) => (
        <View key={index} style={{ flex: 1 }}>
          <View style={{ height: half, justifyContent: "flex-end" }}>
            <View style={{ height: point ? bar(point.rx) : 0, backgroundColor: theme.colors.accent }} />
          </View>
          <View style={{ height: half }}>
            <View style={{ height: point ? bar(point.tx) : 0, backgroundColor: theme.colors.foregroundMuted }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function SystemMonitorItem({ theme }: PluginSidebarItemProps) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { samples, latest, state } = useStats();

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
  const memPercent = (memory.used / memory.total) * 100;
  const diskPercent = disk ? Math.min(100, (disk.used / disk.total) * 100) : 0;

  return (
    <View style={styles.root}>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`CPU ${formatPercent(latest.cpu)}, load ${latest.load[0].toFixed(2)}`}
      >
        <Text style={styles.label}>CPU</Text>
        <PercentChart values={samples.map((s) => s.cpu)} theme={theme} styles={styles} />
        <Text style={styles.value}>{formatPercent(latest.cpu)}</Text>
      </View>

      <View
        style={styles.row}
        accessible
        accessibilityLabel={`Memory ${formatPercent(memPercent)}, ${formatBytes(memory.used)} of ${formatBytes(memory.total, 0)}`}
      >
        <Text style={styles.label}>RAM</Text>
        <PercentChart
          values={samples.map((s) => (s.memory.used / s.memory.total) * 100)}
          theme={theme}
          styles={styles}
        />
        <Text style={styles.value}>{formatPercent(memPercent)}</Text>
      </View>

      {network && (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={`Network download ${formatRateShort(network.rx)} per second, upload ${formatRateShort(network.tx)} per second`}
        >
          <Text style={styles.label}>NET</Text>
          <NetworkChart samples={samples} theme={theme} styles={styles} />
          <View>
            <Text style={[styles.netValue, { color: theme.colors.accent }]}>↓{formatRateShort(network.rx)}</Text>
            <Text style={[styles.netValue, { color: theme.colors.foregroundMuted }]}>
              ↑{formatRateShort(network.tx)}
            </Text>
          </View>
        </View>
      )}

      {disk && (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={`Disk ${formatPercent(diskPercent)} used, ${formatBytes(disk.total - disk.used)} free`}
        >
          <Text style={styles.label}>DISK</Text>
          <PercentChart
            values={samples.map((s) => (s.disk ? (s.disk.used / s.disk.total) * 100 : 0))}
            theme={theme}
            styles={styles}
          />
          <Text style={styles.value}>{formatPercent(diskPercent)}</Text>
        </View>
      )}
    </View>
  );
}
