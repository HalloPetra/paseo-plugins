import { type PluginComposerItemProps, useComposer, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { GRANOLA_ICON } from "../shared/icon";
import { NOTE_SOURCE_ID, noteAttachmentRpc, type NoteSummary } from "../shared/notes";
import { HoverPressable } from "./hover-pressable";
import { NotePicker } from "./note-picker";

export function GranolaComposerItem({ theme, layout }: PluginComposerItemProps) {
  const composer = useComposer();
  const fetchAttachment = useRpc(noteAttachmentRpc);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setLoadingId(null);
    setPickError(null);
  }

  async function pick(note: NoteSummary) {
    const attached = composer.attachments.some(
      (attachment) => attachment.sourceId === NOTE_SOURCE_ID && attachment.item.id === note.id,
    );
    if (attached) {
      close();
      await composer.focus().catch(() => undefined);
      return;
    }
    setPickError(null);
    setLoadingId(note.id);
    try {
      const { item } = await fetchAttachment({ noteId: note.id });
      composer.addAttachment({ sourceId: NOTE_SOURCE_ID, item });
      close();
      await composer.focus().catch(() => undefined);
    } catch (error) {
      setLoadingId(null);
      setPickError(error instanceof Error ? error.message : String(error));
    }
  }

  // New chats only: a draft agent or the New workspace screen. Rendering nothing takes no room.
  if (composer.context === "agent") return null;

  const color = theme.colors.foregroundMuted;
  return (
    <>
      <HoverPressable
        accessibilityRole="button"
        accessibilityLabel="Attach a Granola transcript"
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
        <Icon icon={GRANOLA_ICON} size={14} color={color} />
        <Text style={{ color, fontSize: 13 }} numberOfLines={1}>
          Granola
        </Text>
      </HoverPressable>
      <NotePicker
        theme={theme}
        compact={layout.compact}
        open={open}
        loadingId={loadingId}
        pickError={pickError}
        onClose={close}
        onPick={(note) => void pick(note)}
      />
    </>
  );
}
