import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

export default function HandymanProfile() {
  const insets = useSafeAreaInsets();
  const { user, logout, refresh } = useAuth();

  const startVerify = async () => {
    await api("/verification/start", { method: "POST", body: JSON.stringify({ legal_name: user?.legal_name || user?.email }) });
    await api("/verification/complete", { method: "POST" });
    await refresh();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40 }}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.card}>
        <View style={styles.avatar}><Text style={{ color: colors.onBrandPrimary, fontSize: 28, fontWeight: "800" }}>{(user?.legal_name || user?.email || "?")[0]?.toUpperCase()}</Text></View>
        <Text style={styles.name}>{user?.legal_name || user?.email}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={{ marginTop: 10, flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          <Badge label={`ID ${user?.identity_status || "PENDING"}`} tone={user?.identity_status === "VERIFIED" ? "success" : "warning"} testID="verify-badge" />
          <Badge label="HANDYMAN" tone="brand" />
        </View>
      </View>

      {user?.identity_status !== "VERIFIED" && (
        <View style={{ marginTop: 16 }}>
          <View style={styles.warnBox}>
            <Text style={{ color: colors.warning, fontWeight: "700" }}>Verification required</Text>
            <Text style={{ color: colors.onSurfaceSecondary, marginTop: 4, fontSize: 13 }}>
              Complete identity verification to unlock job claiming.
            </Text>
          </View>
          <Button testID="verify-start" label="Verify my identity" onPress={startVerify} />
        </View>
      )}

      <Text style={styles.section}>Performance</Text>
      <View style={styles.grid}>
        <Stat label="Rating" value={`${user?.rating_avg ?? "—"} ★`} />
        <Stat label="Reliability" value={String(user?.reliability_score ?? "—")} />
        <Stat label="Completed" value={String(user?.completed_jobs ?? 0)} />
      </View>

      <View style={{ marginTop: 20 }}>
        <Button testID="signout-btn" label="Sign out" variant="danger" onPress={logout} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: any) {
  return (
    <View style={styles.stat}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: 4 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 16 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 20, padding: 20, alignItems: "center" },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  name: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  email: { color: colors.muted, marginTop: 2 },
  section: { fontSize: 15, fontWeight: "700", color: colors.onSurface, marginTop: 24, marginBottom: 8 },
  grid: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 14 },
  warnBox: { backgroundColor: "#FBE8CF", padding: 14, borderRadius: 12, marginBottom: 12 },
});
