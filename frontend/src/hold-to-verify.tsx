import React from "react";
import { View, Text, StyleSheet, Pressable, Animated, Platform } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";

/**
 * Professional "Hold to verify" gesture — no math, no puzzle.
 * User presses and holds ~1.2s; timing entropy forms the captcha token.
 * Text selection / context menu / callout are disabled so long-press
 * doesn't hijack the gesture on any platform.
 */
export function HoldToVerify({
  onVerified,
  onReset,
  verified,
  testID,
}: {
  onVerified: (token: string) => void;
  onReset?: () => void;
  verified: boolean;
  testID?: string;
}) {
  const [progress] = React.useState(new Animated.Value(0));
  const holdStart = React.useRef<number | null>(null);
  const targetMs = 1200;

  const startHold = () => {
    if (verified) return;
    holdStart.current = Date.now();
    Animated.timing(progress, { toValue: 1, duration: targetMs, useNativeDriver: false }).start(({ finished }) => {
      if (finished && holdStart.current) {
        const held = Date.now() - holdStart.current;
        const token = `hold_${held}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
        holdStart.current = null;
        onVerified(token);
      }
    });
  };
  const endHold = () => {
    if (verified) return;
    if (holdStart.current) {
      holdStart.current = null;
      Animated.timing(progress, { toValue: 0, duration: 250, useNativeDriver: false }).start();
    }
  };

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  // Extra web props to block long-press text selection / context menu / callout
  const webProps: any = Platform.OS === "web" ? {
    onContextMenu: (e: any) => e.preventDefault?.(),
    onDragStart: (e: any) => e.preventDefault?.(),
    onSelectStart: (e: any) => e.preventDefault?.(),
    draggable: false,
  } : {};

  const noSelectStyle: any = Platform.OS === "web" ? {
    userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
    MozUserSelect: "none", msUserSelect: "none", cursor: "pointer",
  } : {};

  if (verified) {
    return (
      <View
        testID={testID}
        accessibilityRole="button"
        style={[styles.container, { backgroundColor: colors.success, borderColor: colors.success }, noSelectStyle]}
        {...webProps}
      >
        <Icon name="shield-check" size={18} color={colors.onSuccess} />
        <Text selectable={false} style={[styles.label, { color: colors.onSuccess }]}>Human verified</Text>
        {onReset && (
          <Pressable onPress={onReset} hitSlop={8} testID={`${testID}-reset`}>
            <Icon name="refresh" size={16} color={colors.onSuccess} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPressIn={startHold}
      onPressOut={endHold}
      onLongPress={() => { /* no-op; we handle hold via press-in timer */ }}
      delayLongPress={targetMs + 500}
      style={[styles.container, noSelectStyle]}
      accessibilityRole="button"
      accessibilityLabel="Press and hold to verify you are human"
      {...webProps}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, { width }]} />
      <View pointerEvents="none" style={styles.inner}>
        <Icon name="gesture-tap-hold" size={18} color={colors.onSurface} />
        <Text selectable={false} style={styles.label}>Press &amp; hold to verify</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, overflow: "hidden",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, position: "relative",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.brandTertiary },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
});

export default HoldToVerify;
