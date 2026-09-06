import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { colors } from "@/src/theme";
import { Badge } from "@/src/ui";
import { api } from "@/src/api";

export default function CustomerJobs() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["my-jobs"], queryFn: () => api<{ jobs: any[] }>("/jobs?scope=mine") });
  const jobs = q.data?.jobs || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <Text style={styles.title}>My Jobs</Text>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.job_id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["my-jobs"] })} />}
        ListEmptyComponent={<Text style={{ textAlign: "center", color: colors.muted, marginTop: 40 }}>No jobs yet. Post one from the Home tab.</Text>}
        renderItem={({ item }) => (
          <Pressable testID={`job-${item.job_id}`} onPress={() => router.push({ pathname: "/job/[id]", params: { id: item.job_id } })} style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Text style={styles.jobTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.price}>${Number(item.price).toFixed(0)}</Text>
            </View>
            <Text style={styles.meta}>{item.date} · {item.start_time}–{item.end_time}</Text>
            <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
              <Badge label={item.status.replace(/_/g, " ")} tone="brand" />
              {item.urgency === "emergency" && <Badge label="EMERGENCY" tone="warning" />}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, flex: 1, marginRight: 8 },
  price: { color: colors.brandPrimary, fontWeight: "800", fontSize: 16 },
  meta: { color: colors.muted, marginTop: 4, fontSize: 13 },
});
