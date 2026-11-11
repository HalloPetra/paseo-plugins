import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";

type Colors = PluginTheme["colors"];

export interface DropdownOption<Value extends string> {
  value: Value;
  label: string;
  description?: string;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 4;
const MIN_WIDTH = 240;

/**
 * A floating menu anchored to `anchorRef`. Rendered in a transparent modal so it
 * overlays the panel (and escapes clipping parents) on desktop and mobile alike.
 */
export function Dropdown<Value extends string>({
  open,
  onClose,
  anchorRef,
  options,
  selected,
  onSelect,
  colors,
}: {
  open: boolean;
  onClose(): void;
  anchorRef: RefObject<View | null>;
  options: readonly DropdownOption<Value>[];
  selected: Value;
  onSelect(value: Value): void;
  colors: Colors;
}) {
  const screen = useWindowDimensions();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    anchorRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  }, [open, anchorRef]);

  if (!open || !anchor) return null;

  const width = Math.min(Math.max(anchor.width, MIN_WIDTH), screen.width - 16);
  // Right-align with the anchor, but keep on screen.
  const left = Math.max(8, Math.min(anchor.x + anchor.width - width, screen.width - width - 8));
  const below = anchor.y + anchor.height + GAP;
  // Flip above the anchor when there's no room below.
  const top = menuHeight > 0 && below + menuHeight > screen.height - 8 ? Math.max(8, anchor.y - GAP - menuHeight) : below;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1 }}>
        <View
          accessibilityRole="menu"
          onLayout={(e) => setMenuHeight(e.nativeEvent.layout.height)}
          // Stop taps inside the menu from reaching the backdrop.
          onStartShouldSetResponder={() => true}
          style={{
            position: "absolute",
            top,
            left,
            width,
            opacity: menuHeight > 0 ? 1 : 0,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            backgroundColor: colors.surface1,
            paddingVertical: 4,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          {options.map((option) => {
            const isSelected = option.value === selected;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
                  flexDirection: "row",
                  gap: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  backgroundColor: pressed || hovered ? colors.surface2 : undefined,
                })}
              >
                <View style={{ width: 14, paddingTop: 2 }}>
                  {isSelected && <Icon name="Check" size={14} color={colors.foreground} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{option.label}</Text>
                  {option.description && (
                    <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{option.description}</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}
