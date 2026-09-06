import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "@/src/theme";
import { Badge } from "@/src/ui";
import { api } from "@/src/api";

export default function Earnings() {
  const insets = useSafeAreaInsets();
  const s = useQuery({ queryKey: ["earnings"], queryFn: () => api<{ total: number; count: number }>("/earnings/summary") });
  const p = useQuery({ queryKey: ["payouts"], queryFn: () => api<{ items: any[] }>("/payments/mine") });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}>
      <Text style={styles.title}>Earnings</Text>
      <LinearGradient colors={[colors.brandPrimary, colors.brandSecondary]} style={styles.hero}>
        <Text style={styles.heroLabel}>Total earned</Text>
        <Text style={styles.heroAmount}>${(s.data?.total || 0).toFixed(2)}</Text>
        <Text style={styles.heroSub}>{s.data?.count || 0} completed payouts</Text>
      </LinearGradient>

      <Text style={styles.section}>Payout history</Text>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {(p.data?.items || []).length === 0 ? (
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>No payouts yet. Complete a job to see earnings here.</Text>
        ) : (
          (p.data?.items || []).map((it) => (
            <View key={it.payout_id || it.payment_id} style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.rowLabel}>{it.status}</Text>
                <Text style={styles.amount}>${Number(it.amount).toFixed(2)}</Text>
              </View>
              <Text style={styles.meta}>{new Date(it.created_at).toLocaleString()}</Text>
              <View style={{ marginTop: 6 }}><Badge label="MOCKED" tone="muted" /></View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 20 },
  hero: { margin: 20, borderRadius: 20, padding: 20 },
  heroLabel: { color: colors.onBrand, opacity: 0.8 },
  heroAmount: { color: colors.onBrand, fontSize: 40, fontWeight: "800", marginTop: 6 },
  heroSub: { color: colors.onBrand, opacity: 0.8, marginTop: 4 },
  section: { fontSize: 18, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 20, marginBottom: 8 },
  card: { padding: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rowLabel: { fontWeight: "700", color: colors.onSurface },
  amount: { fontWeight: "800", color: colors.brandPrimary },
  meta: { color: colors.muted, fontSize: 12, marginTop: 3 },
});
