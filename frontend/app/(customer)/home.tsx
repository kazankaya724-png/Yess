import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";

import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

type Job = any;

export default function CustomerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const qc = useQueryClient();

  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ categories: any[] }>("/config") });
  const jobsQ = useQuery({
    queryKey: ["my-jobs"],
    queryFn: () => api<{ jobs: Job[] }>("/jobs?scope=mine"),
  });

  const jobs = jobsQ.data?.jobs || [];
  const active = jobs.filter((j) => !["CUSTOMER_APPROVED", "PAYMENT_RELEASED", "CANCELLED"].includes(j.status));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={jobsQ.isRefetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["my-jobs"] })} />}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Hello,</Text>
            <Text style={styles.name}>{user?.legal_name || user?.email?.split("@")[0] || "there"}</Text>
          </View>
          <Pressable testID="logout-btn" onPress={logout} style={styles.iconBtn}>
            <Text style={{ color: colors.onSurface, fontWeight: "600" }}>Sign out</Text>
          </Pressable>
        </View>

        <Pressable testID="post-job-hero" onPress={() => router.push("/(customer)/post-job")}>
          <LinearGradient colors={[colors.brandPrimary, colors.brandSecondary]} style={styles.hero}>
            <Text style={styles.heroTitle}>Need something done?</Text>
            <Text style={styles.heroSub}>Post a job. Get matched with verified pros nearby.</Text>
            <View style={styles.heroCta}><Text style={styles.heroCtaText}>Post a Job →</Text></View>
          </LinearGradient>
        </Pressable>

        <Text style={styles.sectionTitle}>Popular categories</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
          {(cfg.data?.categories || []).map((c: any) => (
            <Pressable
              key={c.id}
              testID={`cat-${c.id}`}
              onPress={() => router.push({ pathname: "/(customer)/post-job", params: { category: c.id } })}
              style={styles.catChip}
            >
              <Text style={styles.catChipText}>{c.name}</Text>
              {c.risk === "HIGH" && <Badge label="LICENSED" tone="warning" />}
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Active jobs</Text>
        {active.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No active jobs</Text>
            <Text style={styles.emptyText}>Got something to fix? Post a job in under a minute.</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {active.map((j) => <JobRow key={j.job_id} job={j} onPress={() => router.push({ pathname: "/job/[id]", params: { id: j.job_id } })} />)}
          </View>
        )}
      </ScrollView>

      <View style={[styles.fab, { bottom: insets.bottom + 76 }]}>
        <Button testID="fab-post-job" label="+ Post a Job" onPress={() => router.push("/(customer)/post-job")} />
      </View>
    </View>
  );
}

function JobRow({ job, onPress }: any) {
  return (
    <Pressable testID={`job-${job.job_id}`} onPress={onPress} style={styles.jobCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text>
        <Text style={styles.jobMeta}>${Number(job.price).toFixed(0)} · {job.date} · {job.start_time}</Text>
        <View style={{ marginTop: 8, flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Badge label={job.status.replace(/_/g, " ")} tone="brand" />
          {job.urgency === "emergency" && <Badge label="EMERGENCY" tone="warning" />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 16 },
  greeting: { color: colors.muted, fontSize: 14 },
  name: { color: colors.onSurface, fontSize: 24, fontWeight: "700" },
  iconBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surfaceSecondary },
  hero: { marginHorizontal: 20, borderRadius: 20, padding: 20, marginBottom: 24 },
  heroTitle: { color: colors.onBrand, fontSize: 22, fontWeight: "700" },
  heroSub: { color: colors.onBrand, opacity: 0.8, marginTop: 6, fontSize: 14 },
  heroCta: { marginTop: 16, backgroundColor: colors.surface, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  heroCtaText: { color: colors.brandPrimary, fontWeight: "700" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 20, marginBottom: 12 },
  catChip: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  catChipText: { color: colors.onSurface, fontWeight: "600" },
  empty: { paddingHorizontal: 20, paddingVertical: 24, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginBottom: 4 },
  emptyText: { color: colors.muted, textAlign: "center", fontSize: 13 },
  jobCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  jobTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  jobMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  fab: { position: "absolute", left: 20, right: 20 },
});
