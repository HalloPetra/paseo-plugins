import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { SwitchRow as SwitchRowData } from "../shared/accounts";
import { formatTime } from "./format";

function message(data: SwitchRowData): string {
  const reset = data.resetsAt ? ` (resets ${formatTime(data.resetsAt)})` : "";
  switch (data.status) {
    case "switched":
      return `${data.from} hit its usage limit${reset}. Switched to ${data.to} and continued.`;
    case "disabled":
      return `${data.from} hit its usage limit${reset}. Automatic switching is off.`;
    case "exhausted":
      return data.nextAvailableAt
        ? `${data.from} hit its usage limit. Every Claude account is limited; the next one frees up ${formatTime(data.nextAvailableAt)}.`
        : `${data.from} hit its usage limit and no other signed-in Claude account is available.`;
  }
}

export function SwitchRow({ theme, item }: PluginTimelineItemProps<SwitchRowData>) {
  const switched = item.data.status === "switched";
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 6,
      },
      text: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme],
  );
  return (
    <View style={styles.row} accessibilityRole="text">
      <Icon
        name={switched ? "ArrowRightLeft" : "CircleAlert"}
        size={14}
        color={switched ? theme.colors.foregroundMuted : theme.colors.statusWarning}
      />
      <Text style={styles.text}>{message(item.data)}</Text>
    </View>
  );
}
