import { type PluginComposerItemProps, useComposer } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { type Issue, issueAttachmentItem } from "../shared/browse";
import { ISSUE_SOURCE_ID } from "../shared/issues";
import { LINEAR_ICON } from "../shared/icon";
import { HoverPressable } from "./hover-pressable";
import { IssuePicker } from "./issue-picker";

export function LinearComposerItem({ theme, layout }: PluginComposerItemProps) {
  const composer = useComposer();
  const [open, setOpen] = useState(false);

  // New chats only: a draft agent or the New workspace screen. Rendering nothing takes no room.
  if (composer.context === "agent") return null;

  async function pick(issue: Issue) {
    setOpen(false);
    const attached = composer.attachments.some(
      (attachment) => attachment.sourceId === ISSUE_SOURCE_ID && attachment.item.id === issue.id,
    );
    if (!attached) composer.addAttachment({ sourceId: ISSUE_SOURCE_ID, item: issueAttachmentItem(issue) });
    await composer.focus();
  }

  const color = theme.colors.foregroundMuted;
  return (
    <>
      <HoverPressable
        accessibilityRole="button"
        accessibilityLabel="Attach a Linear issue"
        onPress={() => setOpen(true)}
        style={({ hovered, pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: layout.compact ? 40 : 28,
          paddingHorizontal: layout.compact ? 12 : 8,
          borderRadius: 6,
          backgroundColor: hovered || pressed || open ? theme.colors.surface2 : "transparent",
        })}
      >
        <Icon icon={{ svg: LINEAR_ICON }} size={14} color={color} />
        <Text style={{ color, fontSize: 13 }} numberOfLines={1}>
          Linear
        </Text>
      </HoverPressable>
      <IssuePicker
        theme={theme}
        compact={layout.compact}
        open={open}
        onClose={() => setOpen(false)}
        onPick={(issue) => void pick(issue)}
      />
    </>
  );
}
