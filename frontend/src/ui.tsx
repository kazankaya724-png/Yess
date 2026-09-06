import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { colors } from "./theme";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  testID,
  small,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  small?: boolean;
}) {
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.brandTertiary,
    ghost: "transparent",
    danger: colors.error,
  }[variant];
  const fg = {
    primary: colors.onBrandPrimary,
    secondary: colors.onBrandTertiary,
    ghost: colors.brandPrimary,
    danger: colors.onError,
  }[variant];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.brandPrimary },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.label, small && { fontSize: 14 }, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: any) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, tone = "brand", testID }: { label: string; tone?: "brand" | "success" | "warning" | "muted"; testID?: string }) {
  const map = {
    brand: [colors.brandTertiary, colors.onBrandTertiary],
    success: [colors.brandTertiary, colors.success],
    warning: ["#FBE8CF", colors.warning],
    muted: [colors.surfaceTertiary, colors.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Section({ title, children, right }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Input({ label, ...props }: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View style={styles.inputWrap}>
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSmall: { minHeight: 36, paddingHorizontal: 14, borderRadius: 8 },
  label: { fontSize: 16, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  inputLabel: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary, marginBottom: 6 },
  inputWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
