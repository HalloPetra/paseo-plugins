import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { MESSAGE_KINDS, type MessageKind } from "../shared/envelope";

export const messageSchema = z.object({
  kind: z.enum(MESSAGE_KINDS),
  from: z.string(),
  threadId: z.string(),
  expectsReply: z.boolean(),
  body: z.string(),
});

type Message = z.output<typeof messageSchema>;

/** For screen readers. */
const KIND_LABELS: Record<MessageKind, string | null> = {
  message: null,
  question: "Question",
  reply: "Reply",
  report: "Report",
  task: "Task",
};

/** Bubbles taller than this start collapsed. */
const COLLAPSED_HEIGHT = 240;

export function OrchestratorMessageCard({ item, theme, layout }: PluginTimelineItemProps<Message>) {
  const { body, kind, from, expectsReply } = item.data;
  const [contentHeight, setContentHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const collapsible = contentHeight > COLLAPSED_HEIGHT + 40;
  const collapsed = collapsible && !expanded;
  const label = KIND_LABELS[kind];

  const styles = useMemo(
    () => ({
      column: {
        gap: 4,
        marginVertical: 6,
        maxWidth: layout.compact ? ("100%" as const) : ("85%" as const),
      },
      bubble: {
        alignSelf: "flex-start" as const,
        maxWidth: "100%" as const,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 8,
        overflow: "hidden" as const,
      },
      clip: { maxHeight: COLLAPSED_HEIGHT, overflow: "hidden" as const },
      toggle: { color: theme.colors.accent, fontSize: 12, marginTop: 6 },
      footer: { color: theme.colors.foregroundMuted, fontSize: 11, marginLeft: 2 },
    }),
    [theme, layout.compact],
  );

  const onContentLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (Math.abs(height - contentHeight) > 1) setContentHeight(height);
  };

  return (
    <View style={styles.column} accessibilityLabel={`${label ?? "Message"} from ${from}`}>
      <View style={styles.bubble}>
        <View style={collapsed ? styles.clip : undefined}>
          <View onLayout={onContentLayout}>
            <Markdown>{body}</Markdown>
          </View>
        </View>
        {collapsible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((value) => !value)}
          >
            <Text style={styles.toggle}>{expanded ? "Show less" : "Show more"}</Text>
          </Pressable>
        ) : null}
      </View>
      {expectsReply ? <Text style={styles.footer}>Waiting for a reply</Text> : null}
    </View>
  );
}
