import { useState } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

type Props = Omit<PressableProps, "style"> & {
  style(state: { hovered: boolean; pressed: boolean }): StyleProp<ViewStyle>;
};

/** Pressable that reports hover on web and desktop; hover stays false on touch devices. */
export function HoverPressable({ style, onHoverIn, onHoverOut, ...props }: Props) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...props}
      onHoverIn={(event) => {
        setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      style={({ pressed }) => style({ hovered, pressed })}
    />
  );
}
