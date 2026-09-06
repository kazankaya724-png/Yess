import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Svg, { Circle, Line, G } from "react-native-svg";
import Animated, {
  useSharedValue, useAnimatedProps, withRepeat, withTiming, Easing,
} from "react-native-reanimated";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";

const ACircle = Animated.createAnimatedComponent(Circle);

/** Radar-style visualization of nearby jobs. Cross-platform (web + native). */
export function RadarView({
  jobs,
  onPress,
  maxRadiusMiles = 60,
}: {
  jobs: Array<{ job_id: string; distance_miles?: number; price: number; urgency?: string; title: string; category?: string }>;
  onPress: (jobId: string) => void;
  maxRadiusMiles?: number;
}) {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const rings = [15, 30, 60];

  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: 3500, easing: Easing.linear }), -1, false);
  }, []);
  const sweepProps = useAnimatedProps(() => {
    const r = Math.max(0.01, sweep.value * (size / 2 - 6));
    return { r, opacity: 1 - sweep.value };
  });

  // Position each job at an angle based on job_id hash, radius based on distance
  const positioned = jobs.map((j, i) => {
    const seed = (j.job_id || String(i)).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const angle = (seed % 360) * Math.PI / 180;
    const dist = Math.min(j.distance_miles ?? 30, maxRadiusMiles);
    const rPx = (dist / maxRadiusMiles) * (size / 2 - 20);
    return { ...j, x: cx + Math.cos(angle) * rPx, y: cy + Math.sin(angle) * rPx };
  });

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size, alignSelf: "center" }}>
        <Svg width={size} height={size}>
          {rings.map((r, i) => (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={(r / maxRadiusMiles) * (size / 2 - 20)}
              stroke={colors.border}
              strokeWidth={1}
              fill="none"
            />
          ))}
          <Line x1={0} y1={cy} x2={size} y2={cy} stroke={colors.border} strokeWidth={0.5} />
          <Line x1={cx} y1={0} x2={cx} y2={size} stroke={colors.border} strokeWidth={0.5} />
          <G>
            <ACircle cx={cx} cy={cy} stroke={colors.brandPrimary} strokeWidth={1.5} fill="none" animatedProps={sweepProps} />
          </G>
          <Circle cx={cx} cy={cy} r={6} fill={colors.brandPrimary} />
        </Svg>
        {positioned.map((j) => (
          <Pressable
            key={j.job_id}
            testID={`radar-pin-${j.job_id}`}
            onPress={() => onPress(j.job_id)}
            style={[styles.pin, { left: j.x - 18, top: j.y - 18, backgroundColor: j.urgency === "emergency" ? colors.error : colors.brandPrimary }]}
          >
            <Text style={styles.pinText}>${Math.round(j.price)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: colors.brandPrimary }]} /><Text style={styles.legendText}>You</Text></View>
        <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: colors.error }]} /><Text style={styles.legendText}>Emergency</Text></View>
        <View style={styles.legendRow}><Icon name="circle-outline" size={12} color={colors.muted} /><Text style={styles.legendText}>15 / 30 / 60 mi</Text></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, backgroundColor: colors.surfaceSecondary, borderRadius: 20, marginHorizontal: 20 },
  pin: {
    position: "absolute", width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, elevation: 3,
    borderWidth: 2, borderColor: colors.surface,
  },
  pinText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11 },
  legend: { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 12, flexWrap: "wrap" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.muted, fontWeight: "600" },
});

export default RadarView;
