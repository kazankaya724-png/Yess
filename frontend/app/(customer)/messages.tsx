import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function Messages() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["messages-jobs", user?.role],
    queryFn: () => api<{ jobs: any[] }>(user?.role === "handyman" ? "/jobs?scope=mine" : "/jobs?scope=mine"),
  });
  const jobs = (q.data?.jobs || []).filter((j) => j.handyman_id && !["CANCELLED"].includes(j.status));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <Text style={styles.title}>Messages</Text>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.job_id}
        contentContainerStyle={{ padding: 20, gap: 10 }}
        ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>No conversations yet.</Text>}
        renderItem={({ item }) => (
          <Pressable testID={`msg-${item.job_id}`} onPress={() => router.push({ pathname: "/job/[id]", params: { id: item.job_id, tab: "chat" } })} style={styles.row}>
            <Text style={styles.name}>{item.title}</Text>
            <Text style={styles.sub}>{item.status.replace(/_/g, " ")}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, paddingHorizontal: 20 },
  row: { padding: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 12 },
  name: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
