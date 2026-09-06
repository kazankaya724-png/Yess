import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { colors } from "@/src/theme";
import { Badge } from "@/src/ui";
import { api } from "@/src/api";
import { RadarView } from "@/src/radar-view";

export default function Available() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const [view, setView] = useState<"list" | "radar">("radar");
  const q = useQuery({ queryKey: ["available-jobs"], queryFn: () => api<{ jobs: any[]; reason?: string }>("/jobs/available") });
  const jobs = q.data?.jobs || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View>
          <Text style={styles.title}>Find Jobs</Text>
          <Text style={styles.sub}>{jobs.length} within 30–60 mi</Text>
        </View>
        <View style={styles.toggle}>
          <Pressable testID="view-radar" onPress={() => setView("radar")} style={[styles.toggleBtn, view === "radar" && styles.toggleBtnActive]}>
            <Icon name="radar" size={16} color={view === "radar" ? colors.onBrandPrimary : colors.onSurface} />
          </Pressable>
          <Pressable testID="view-list" onPress={() => setView("list")} style={[styles.toggleBtn, view === "list" && styles.toggleBtnActive]}>
            <Icon name="format-list-bulleted" size={16} color={view === "list" ? colors.onBrandPrimary : colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {view === "radar" && jobs.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <RadarView jobs={jobs} onPress={(id) => router.push({ pathname: "/job/[id]", params: { id } })} />
        </View>
      )}

      <FlatList
        data={view === "radar" ? jobs.slice(0, 3) : jobs}
        keyExtractor={(j) => j.job_id}
        contentContainerStyle={{ padding: 20, paddingTop: view === "radar" ? 4 : 20, gap: 12 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["available-jobs"] })} />}
        ListHeaderComponent={view === "radar" && jobs.length > 0 ? <Text style={styles.listHeader}>Closest jobs</Text> : null}
        ListEmptyComponent={
          <View style={{ padding: 24, alignItems: "center" }}>
            <Icon name="magnify" size={40} color={colors.muted} />
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 6 }}>
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
  toggle: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: 999, padding: 4, gap: 4 },
  toggleBtn: { width: 40, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  toggleBtnActive: { backgroundColor: colors.brandPrimary },
  listHeader: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, flex: 1, marginRight: 8 },
  price: { color: colors.brandPrimary, fontWeight: "800", fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 3 },
});
