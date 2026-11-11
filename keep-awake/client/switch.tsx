import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable } from "react-native";

/**
 * A step below Paseo's settings switch (34×20 on desktop, 44×26 on touch), sized to sit in a
 * sidebar row without outweighing its label.
 */
const GEOMETRY = {
  desktop: { width: 28, height: 16, thumb: 12 },
  touch: { width: 38, height: 22, thumb: 18 },
};

const THUMB_OFF = "#ffffff";

interface ThemedSwitchProps {
  theme: PluginTheme;
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
  compact?: boolean;
  accessibilityLabel: string;
}

/**
 * Mirrors the switch Paseo draws in its settings: `accent` track and `accentForeground` thumb when
 * on, a neutral track and white thumb when off, half opacity when disabled. React Native's own
 * `Switch` uses platform colors that ignore the Paseo theme. The plugin theme has no `surface3`,
 * so the off track uses `border`.
 */
export function ThemedSwitch({ theme, value, onValueChange, disabled, compact, accessibilityLabel }: ThemedSwitchProps) {
  const { width, height, thumb } = compact ? GEOMETRY.touch : GEOMETRY.desktop;
  const inset = (height - thumb) / 2;
  const travel = width - thumb - inset * 2;
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [value, progress]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        style={{
          width,
          height,
          borderRadius: height / 2,
          padding: inset,
          justifyContent: "center",
          backgroundColor: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [theme.colors.border, theme.colors.accent],
          }),
        }}
      >
        <Animated.View
          style={{
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
            shadowColor: "rgba(0, 0, 0, 0.25)",
            shadowOffset: { width: 0, height: 1 },
            shadowRadius: 2,
            shadowOpacity: 1,
            elevation: 2,
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [THUMB_OFF, theme.colors.accentForeground],
            }),
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
