import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop, Rect, G, Line } from "react-native-svg";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";

/** Cross-platform "approximate service area" card.
 * Shows a stylized map tile with a filled circle indicating a ~500m privacy radius
 * around the approximate location. Never renders the exact address.
 */
export function PrivacyAreaCard({
  city,
  state,
  zip,
  radiusMeters = 500,
}: {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  radiusMeters?: number;
}) {
  const w = 320;
  const h = 160;
  const cx = w / 2;
  const cy = h / 2;
  const R = 62; // visual radius; represents `radiusMeters`

  return (
    <View style={styles.card} testID="privacy-area-card">
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={colors.brandPrimary} stopOpacity="0.35" />
            <Stop offset="100%" stopColor={colors.brandPrimary} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={w} height={h} fill={colors.surfaceTertiary} />
        {/* stylized street grid */}
        <G opacity={0.35}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Line key={`h${i}`} x1={0} y1={(i + 1) * (h / 7)} x2={w} y2={(i + 1) * (h / 7)} stroke={colors.borderStrong} strokeWidth="1" />
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <Line key={`v${i}`} x1={(i + 1) * (w / 9)} y1={0} x2={(i + 1) * (w / 9)} y2={h} stroke={colors.borderStrong} strokeWidth="1" />
          ))}
        </G>
        {/* privacy halo */}
        <Circle cx={cx} cy={cy} r={R + 20} fill="url(#g)" />
        {/* privacy circle */}
        <Circle cx={cx} cy={cy} r={R} fill={colors.brandPrimary} fillOpacity={0.18} stroke={colors.brandPrimary} strokeWidth={2} strokeDasharray="6 4" />
        {/* center pin */}
        <Circle cx={cx} cy={cy} r={5} fill={colors.brandPrimary} />
      </Svg>
      <View style={styles.footer}>
        <Icon name="map-marker-radius" size={16} color={colors.brandPrimary} />
        <Text style={styles.footerText} numberOfLines={1}>
          Approximate area · ~{radiusMeters}m radius
          {city || state ? ` · ${[city, state].filter(Boolean).join(", ")}` : ""}
          {zip ? ` ${zip}` : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, overflow: "hidden", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surface },
  footerText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600", flex: 1 },
});

export default PrivacyAreaCard;
