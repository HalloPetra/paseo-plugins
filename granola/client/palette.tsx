import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";

/**
 * A headerless dialog: a dimmed backdrop and a card near the top of the window on desktop,
 * a sheet from the bottom on compact layouts. Backdrop press and Escape/back close it.
 */
export function Palette({
  theme,
  compact,
  open,
  onClose,
  children,
}: {
  theme: PluginTheme;
  compact: boolean;
  open: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <Modal visible={open} transparent animationType={compact ? "slide" : "fade"} onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: compact ? "flex-end" : "flex-start",
          paddingTop: compact ? 0 : "12%",
          paddingHorizontal: compact ? 0 : 16,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: compact ? undefined : 640,
            maxHeight: compact ? "90%" : "80%",
            overflow: "hidden",
            borderRadius: 12,
            borderBottomLeftRadius: compact ? 0 : 12,
            borderBottomRightRadius: compact ? 0 : 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface0,
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 16,
            paddingBottom: compact ? 24 : 0,
          }}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}
