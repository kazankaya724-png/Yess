import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => api<any>("/admin/stats") });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<{ users: any[] }>("/admin/users") });
  const jobs = useQuery({ queryKey: ["admin-jobs"], queryFn: () => api<{ jobs: any[] }>("/admin/jobs") });

  const suspend = async (uid: string, suspended: boolean) => {
    await api(`/admin/users/${uid}/suspend`, { method: "POST", body: JSON.stringify({ suspended }) });
    users.refetch();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.title}>SPIKE Admin</Text>
        <Pressable testID="admin-logout" onPress={logout}><Text style={{ color: colors.error, fontWeight: "700" }}>Sign out</Text></Pressable>
      </View>

      <View style={styles.grid}>
        <Stat label="Users" value={stats.data?.users} />
        <Stat label="Jobs" value={stats.data?.jobs} />
        <Stat label="Open disputes" value={stats.data?.open_disputes} />
        <Stat label="Revenue" value={`$${(stats.data?.revenue || 0).toFixed(2)}`} />
      </View>

      <Text style={styles.section}>Users</Text>
      {(users.data?.users || []).map((u) => (
        <View key={u.user_id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{u.legal_name || u.email}</Text>
            <Text style={styles.sub}>{u.email} · {u.role}</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
              <Badge label={u.identity_status || "PENDING"} tone={u.identity_status === "VERIFIED" ? "success" : "warning"} />
              {u.suspended && <Badge label="SUSPENDED" tone="warning" />}
            </View>
          </View>
          <Button testID={`suspend-${u.user_id}`} small label={u.suspended ? "Unsuspend" : "Suspend"} variant={u.suspended ? "secondary" : "danger"} onPress={() => suspend(u.user_id, !u.suspended)} />
        </View>
      ))}

      <Text style={styles.section}>Recent jobs</Text>
      {(jobs.data?.jobs || []).slice(0, 20).map((j) => (
        <View key={j.job_id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{j.title}</Text>
            <Text style={styles.sub}>{j.status.replace(/_/g, " ")} · ${j.price}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value }: any) {
  return (
    <View style={styles.stat}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: 4 }}>{value ?? "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  stat: { width: "48%", padding: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 12 },
  section: { fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: 24, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  name: { fontWeight: "700", color: colors.onSurface },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
