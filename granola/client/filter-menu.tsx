import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { HoverPressable } from "./hover-pressable";

export interface MenuOption {
  key: string;
  label: string;
  selected: boolean;
  leading?: ReactNode;
  onPress(): void;
}

/** A small toolbar button: icon, plus the active value when it differs from the default. */
export function FilterButton({
  theme,
  icon,
  title,
  value,
  active,
  open,
  onPress,
  onLayoutX,
}: {
  theme: PluginTheme;
  icon: string;
  title: string;
  value: string;
  active: boolean;
  open: boolean;
  onPress(): void;
  onLayoutX(x: number): void;
}) {
  const color = active ? theme.colors.foreground : theme.colors.foregroundMuted;
  return (
    <HoverPressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      onLayout={(event) => onLayoutX(event.nativeEvent.layout.x)}
      style={({ hovered }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 24,
        paddingHorizontal: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: active ? theme.colors.border : "transparent",
        backgroundColor: open || hovered ? theme.colors.surface2 : active ? theme.colors.surface1 : "transparent",
      })}
    >
      <Icon name={icon} size={13} color={color} />
      <Text style={{ color, fontSize: 12, maxWidth: 120 }} numberOfLines={1}>
        {value}
      </Text>
    </HoverPressable>
  );
}

/** Dropdown list drawn below the toolbar, aligned with the button that opened it. */
const MENU_WIDTH = 220;
const MENU_MARGIN = 8;

export function FilterMenu({
  theme,
  title,
  left,
  top,
  boundsWidth,
  options,
  header,
  footer,
}: {
  theme: PluginTheme;
  title: string;
  left: number;
  top: number;
  /** Width of the area the menu must stay inside. */
  boundsWidth: number;
  options: MenuOption[];
  /** Drawn between the title and the options, e.g. a text field. */
  header?: ReactNode;
  footer?: { label: string; onPress(): void };
}) {
  const width = Math.min(MENU_WIDTH, Math.max(160, boundsWidth - MENU_MARGIN * 2));
  const clampedLeft = Math.max(MENU_MARGIN, Math.min(left, boundsWidth - width - MENU_MARGIN));
  return (
    <View
      style={{
        position: "absolute",
        top,
        left: clampedLeft,
        width,
        maxHeight: 320,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
        zIndex: 20,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 10, paddingVertical: 4 }}>
        {title}
      </Text>
      {header}
      <ScrollView keyboardShouldPersistTaps="handled">
        {options.map((option) => (
          <HoverPressable
            key={option.key}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: option.selected }}
            onPress={option.onPress}
            style={({ hovered }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              height: 28,
              paddingHorizontal: 10,
              marginHorizontal: 4,
              borderRadius: 4,
              backgroundColor: hovered ? theme.colors.surface2 : "transparent",
            })}
          >
            {option.leading}
            <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }} numberOfLines={1}>
              {option.label}
            </Text>
            {option.selected ? <Icon name="Check" size={14} color={theme.colors.foreground} /> : null}
          </HoverPressable>
        ))}
      </ScrollView>
      {footer ? (
        <Pressable
          accessibilityRole="button"
          onPress={footer.onPress}
          style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 4 }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{footer.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
