import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/src/theme";
import { api } from "@/src/api";

export default function Payments() {
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ["payments"], queryFn: () => api<{ items: any[] }>("/payments/mine") });
  const items = q.data?.items || [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <Text style={styles.title}>Payments</Text>
      <FlatList
        data={items}
        keyExtractor={(p) => p.payment_id || p.payout_id}
        contentContainerStyle={{ padding: 20, gap: 10 }}
        ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>No payments yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.label}>{item.status}</Text>
              <Text style={styles.amount}>${Number(item.amount).toFixed(2)}</Text>
            </View>
            <Text style={styles.meta}>{new Date(item.created_at).toLocaleString()}</Text>
            {item.commission !== undefined && <Text style={styles.meta}>Commission: ${item.commission}</Text>}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  label: { fontWeight: "700", color: colors.onSurface },
  amount: { fontWeight: "800", color: colors.brandPrimary },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
