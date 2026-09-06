import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { useAuth } from "@/src/auth";

export default function CustomerProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40 }}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.card}>
        <View style={styles.avatar}><Text style={{ color: colors.onBrandPrimary, fontSize: 28, fontWeight: "800" }}>{(user?.email || "?")[0].toUpperCase()}</Text></View>
        <Text style={styles.name}>{user?.legal_name || user?.email}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
          <Badge label={`${user?.identity_status || "PENDING"}`} tone={user?.identity_status === "VERIFIED" ? "success" : "warning"} />
          <Badge label="CUSTOMER" tone="brand" />
        </View>
      </View>
      <Text style={styles.section}>Account</Text>
      <View style={styles.info}>
        <Row k="Rating" v={String(user?.rating_avg || "—")} />
        <Row k="Completed jobs" v={String(user?.completed_jobs || 0)} />
        <Row k="ZIP" v={String(user?.zip_code || "—")} />
      </View>
      <View style={{ marginTop: 20 }}>
        <Pressable testID="open-support" onPress={() => router.push("/support")} style={styles.supportBtn}>
          <Icon name="lifebuoy" size={20} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }}>Get help</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Chat live with SPIKE Support.</Text>
          </View>
          <Icon name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={{ marginTop: 20 }}>
        <Button testID="signout-btn" label="Sign out" variant="danger" onPress={logout} />
      </View>
    </ScrollView>
  );
}
function Row({ k, v }: any) {
  return (
    <View style={styles.row}>
      <Text style={{ color: colors.muted }}>{k}</Text>
      <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{v}</Text>
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
  info: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  supportBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
});
