import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, Markdown, Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";

export const reportSchema = z.object({
  from: z.string(),
  body: z.string(),
});

type Report = z.output<typeof reportSchema>;

// Mirrors Paseo's tool call badge (ExpandableBadge): spacing 4/8, radius 8,
// base font 14, 22px icon slot with a 12px icon, -13 bleed into the stream gutter.
const SPACE_1 = 4;
const SPACE_2 = 8;
const SPACE_3 = 12;
const RADIUS_LG = 8;
const FONT_BASE = 14;
const ICON_SIZE = 12;
const DETAIL_MAX_HEIGHT = 400;

function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/[*_`#>]/g, "")
    .trim();
}

export function SubagentReportCard({ item, theme, layout }: PluginTimelineItemProps<Report>) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const { body } = item.data;
  const summary = useMemo(() => firstLine(body), [body]);

  // Like tool calls: inline details on wide layouts, a sheet on compact ones.
  const inline = !layout.compact;
  const inlineOpen = inline && expanded;
  const active = hovered || inlineOpen;
  const showChevron = !layout.compact && active;

  const styles = useMemo(
    () => ({
      container: { marginHorizontal: -13, marginBottom: SPACE_1 },
      pressable: {
        borderRadius: RADIUS_LG,
        borderWidth: 1,
        borderColor: "transparent",
        paddingHorizontal: SPACE_2,
        paddingVertical: SPACE_1,
        overflow: "hidden" as const,
      },
      pressableExpanded: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      },
      headerRow: { flexDirection: "row" as const, alignItems: "center" as const },
      iconSlot: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        marginRight: SPACE_1,
      },
      label: {
        color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
        fontSize: FONT_BASE,
        flexShrink: 0,
      },
      secondary: {
        color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
        fontSize: FONT_BASE,
        marginLeft: SPACE_2,
        flexShrink: 1,
        minWidth: 0,
      },
      detail: {
        borderBottomLeftRadius: RADIUS_LG,
        borderBottomRightRadius: RADIUS_LG,
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: theme.colors.border,
        overflow: "hidden" as const,
      },
      detailScroll: { maxHeight: DETAIL_MAX_HEIGHT },
      detailContent: { paddingHorizontal: SPACE_3, paddingVertical: SPACE_2 },
    }),
    [theme, active],
  );

  const iconColor = active ? theme.colors.foreground : theme.colors.foregroundMuted;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Subagent report: ${summary}`}
        accessibilityState={inline ? { expanded } : undefined}
        onPress={() => setExpanded((value) => !value)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.pressable, pressed && { opacity: 0.9 }, inlineOpen && styles.pressableExpanded]}
      >
        <View style={styles.headerRow}>
          <View style={styles.iconSlot}>
            {showChevron ? (
              <View
                style={{
                  marginLeft: -4,
                  transform: inlineOpen ? [{ scale: 1.3 }, { rotate: "90deg" }] : [{ scale: 1.3 }],
                }}
              >
                <Icon name="ChevronRight" size={ICON_SIZE} color={theme.colors.foreground} />
              </View>
            ) : (
              <Icon name="Bot" size={ICON_SIZE} color={iconColor} />
            )}
          </View>
          <Text style={styles.label}>Subagent report</Text>
          {summary ? (
            <Text style={styles.secondary} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {inlineOpen ? (
        <View style={styles.detail}>
          <ScrollView
            style={styles.detailScroll}
            contentContainerStyle={styles.detailContent}
            nestedScrollEnabled
          >
            <Markdown>{body}</Markdown>
          </ScrollView>
        </View>
      ) : null}

      {!inline ? (
        <Modal
          title="Subagent report"
          icon={<Icon name="Bot" size={16} color={theme.colors.foregroundMuted} />}
          open={expanded}
          onOpenChange={setExpanded}
        >
          <Modal.Content>
            <Markdown>{body}</Markdown>
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}
