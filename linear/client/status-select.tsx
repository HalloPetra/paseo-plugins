import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import type { StateChoice } from "../shared/status";
import { HoverPressable } from "./hover-pressable";
import { StatusIcon } from "./status-icon";

const MENU_WIDTH = 220;
const MENU_MAX_HEIGHT = 320;
const MARGIN = 8;

/**
 * A status dropdown drawn like the header's status switcher: Linear state icons in their
 * colors, a check on the current choice. `null` is "Don't change".
 */
export function StatusSelect({
  theme,
  label,
  value,
  states,
  disabled,
  onChange,
}: {
  theme: PluginTheme;
  label: string;
  value: string | null;
  states: readonly StateChoice[];
  disabled?: boolean;
  onChange(value: string | null): void;
}) {
  const trigger = useRef<View>(null);
  const viewport = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const muted = theme.colors.foregroundMuted;
  const selected = value ? states.find((state) => state.name.toLowerCase() === value.toLowerCase()) : undefined;

  function open() {
    trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  }
  function choose(next: string | null) {
    setAnchor(null);
    if (next !== value) onChange(next);
  }

  const options: { key: string; name: string | null; label: string; icon: ReactNode }[] = [
    { key: "", name: null, label: "Don't change", icon: <Icon name="Minus" size={14} color={muted} /> },
    // Keep a saved status visible even if no team has it anymore.
    ...(value && !selected
      ? [{ key: `saved:${value}`, name: value, label: value, icon: <StatusIcon type="unstarted" color={muted} /> }]
      : []),
    ...states.map((state) => ({
      key: state.name,
      name: state.name,
      label: state.name,
      icon: <StatusIcon type={state.type} color={state.color} />,
    })),
  ];

  // Below the trigger, right-aligned to it; flip above when there is no room.
  let menuStyle = null;
  if (anchor) {
    const left = Math.max(MARGIN, Math.min(anchor.x + anchor.width - MENU_WIDTH, viewport.width - MENU_WIDTH - MARGIN));
    const below = anchor.y + anchor.height + 4;
    const fitsBelow = below + MENU_MAX_HEIGHT <= viewport.height - MARGIN;
    menuStyle = fitsBelow ? { left, top: below } : { left, bottom: viewport.height - anchor.y + 4 };
  }

  return (
    <>
      <View ref={trigger} collapsable={false}>
        <HoverPressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${selected?.name ?? value ?? "Don't change"}`}
          accessibilityState={{ expanded: anchor !== null, disabled }}
          disabled={disabled}
          onPress={open}
          style={({ hovered }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 28,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: hovered || anchor ? theme.colors.surface2 : theme.colors.surface1,
            opacity: disabled ? 0.5 : 1,
          })}
        >
          {selected ? (
            <StatusIcon type={selected.type} color={selected.color} />
          ) : value ? (
            <StatusIcon type="unstarted" color={muted} />
          ) : null}
          <Text
            style={{ color: value ? theme.colors.foreground : muted, fontSize: 13, maxWidth: 160 }}
            numberOfLines={1}
          >
            {selected?.name ?? value ?? "Don't change"}
          </Text>
          <Icon name="ChevronDown" size={14} color={muted} />
        </HoverPressable>
      </View>
      <Modal visible={anchor !== null} transparent animationType="none" onRequestClose={() => setAnchor(null)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => setAnchor(null)}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {menuStyle ? (
          <ScrollView
            style={{
              position: "absolute",
              ...menuStyle,
              width: MENU_WIDTH,
              maxHeight: MENU_MAX_HEIGHT,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 8,
            }}
            contentContainerStyle={{ padding: 4, gap: 2 }}
          >
            {options.map((option) => {
              const current = (option.name ?? "").toLowerCase() === (value ?? "").toLowerCase();
              return (
                <HoverPressable
                  key={option.key}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: current }}
                  onPress={() => choose(option.name)}
                  style={({ hovered }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    height: 30,
                    paddingHorizontal: 8,
                    borderRadius: 6,
                    backgroundColor: hovered ? theme.colors.surface2 : "transparent",
                  })}
                >
                  {option.icon}
                  <Text
                    style={{ flex: 1, color: option.name ? theme.colors.foreground : muted, fontSize: 13 }}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {current ? <Icon name="Check" size={14} color={theme.colors.foreground} /> : null}
                </HoverPressable>
              );
            })}
          </ScrollView>
        ) : null}
      </Modal>
    </>
  );
}
