import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { colors } from "@/src/theme";
import { Badge } from "@/src/ui";
import { api } from "@/src/api";

export default function Available() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["available-jobs"], queryFn: () => api<{ jobs: any[]; reason?: string }>("/jobs/available") });
  const jobs = q.data?.jobs || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <Text style={styles.title}>Find Jobs</Text>
        <Text style={styles.sub}>Available within {30}–{60} mi radius</Text>
      </View>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.job_id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["available-jobs"] })} />}
        ListEmptyComponent={
          <View style={{ padding: 24, alignItems: "center" }}>
            <Text style={{ color: colors.muted, textAlign: "center" }}>
              {q.data?.reason === "identity_not_verified"
                ? "Complete identity verification to see available jobs."
                : "No jobs in your area right now. Pull to refresh."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable testID={`avail-${item.job_id}`} onPress={() => router.push({ pathname: "/job/[id]", params: { id: item.job_id } })} style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.jobTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.price}>${Number(item.price).toFixed(0)}</Text>
            </View>
            <Text style={styles.meta}>{item.category} · {item.date} · {item.start_time}</Text>
            <Text style={styles.meta}>~{item.distance_miles ?? "?"} mi · ZIP {item.zip_area}</Text>
            <View style={{ marginTop: 8, flexDirection: "row", gap: 6 }}>
              {item.urgency === "emergency" && <Badge label="EMERGENCY" tone="warning" />}
              <Badge label="CLAIMABLE" tone="brand" />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  sub: { color: colors.muted, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, flex: 1, marginRight: 8 },
  price: { color: colors.brandPrimary, fontWeight: "800", fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 3 },
});
