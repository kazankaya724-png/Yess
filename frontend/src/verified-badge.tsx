import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolateColor,
} from "react-native-reanimated";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";

/** Animated verified badge with a soft pulse ring + shimmer. */
export function VerifiedBadge({
  label = "VERIFIED",
  size = "sm",
  tone = "brand",
  testID,
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
  tone?: "brand" | "gold" | "silver";
  testID?: string;
}) {
  const pulse = useSharedValue(0);
  const shine = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.ease) }), -1, false);
    shine.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1, false);
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.6 }],
    opacity: 0.55 * (1 - pulse.value),
  }));
  const shineStyle = useAnimatedStyle(() => {
    const c = interpolateColor(shine.value, [0, 0.5, 1], [
      "rgba(255,255,255,0.0)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0.0)",
    ]);
    return { backgroundColor: c };
  });

  const palette = {
    brand: { bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    gold:  { bg: "#B8873B", fg: "#FFFFFF" },
    silver:{ bg: "#67706B", fg: "#FFFFFF" },
  }[tone];

  const dim = size === "lg" ? 28 : size === "md" ? 22 : 18;

  return (
    <View testID={testID} style={styles.wrap}>
      <Animated.View pointerEvents="none" style={[styles.ring, { width: dim + 12, height: dim + 12, borderRadius: (dim + 12) / 2, backgroundColor: palette.bg }, ringStyle]} />
      <View style={[styles.pill, { backgroundColor: palette.bg, height: dim, borderRadius: dim / 2 }]}>
        <Icon name="check-decagram" size={dim - 6} color={palette.fg} />
        {!!label && <Text style={[styles.label, { color: palette.fg, fontSize: dim - 8 }]} numberOfLines={1}>{label}</Text>}
        <Animated.View pointerEvents="none" style={[styles.shine, shineStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  ring: { position: "absolute" },
  pill: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 4, overflow: "hidden",
  },
  label: { fontWeight: "800", letterSpacing: 0.6, marginLeft: 4 },
  shine: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
});

export default VerifiedBadge;
