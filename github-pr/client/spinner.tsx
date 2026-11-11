import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform } from "react-native";

/** A continuously rotating icon. `spinning={false}` renders it still. */
export function Spinner({
  name = "LoaderCircle",
  size,
  color,
  spinning = true,
}: {
  name?: string;
  size: number;
  color: string;
  spinning?: boolean;
}) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spinning) {
      rotation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Icon name={name} size={size} color={color} />
    </Animated.View>
  );
}
