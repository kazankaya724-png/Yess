import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["support"],
    queryFn: () => api<{ messages: any[] }>("/support/messages"),
    refetchInterval: 5000,
  });

  const send = async () => {
    if (!msg.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api("/support/messages", { method: "POST", body: JSON.stringify({ body: msg }) });
      setMsg("");
      qc.invalidateQueries({ queryKey: ["support"] });
    } catch (e: any) { setErr(e.message || "Send failed"); }
    finally { setBusy(false); }
  };

  const msgs = q.data?.messages || [];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable testID="support-back" onPress={() => router.back()} hitSlop={12}>
            <Icon name="chevron-left" size={26} color={colors.brandPrimary} />
          </Pressable>
          <View style={styles.headerBadge}>
            <Icon name="lifebuoy" size={14} color={colors.onBrandPrimary} />
            <Text style={styles.headerBadgeText}>Live Support</Text>
          </View>
          <View style={{ width: 26 }} />
        </View>
        <Text style={styles.title}>SPIKE Support</Text>
        <Text style={styles.sub}>We usually reply within a few minutes.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
        {msgs.length === 0 && (
          <View style={styles.emptyState}>
            <Icon name="chat-question-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyTitle}>How can we help?</Text>
            <Text style={styles.emptyText}>Ask about a job, payment, verification, or safety — a real human will reply.</Text>
          </View>
        )}
        {msgs.map((m) => {
          const isMe = m.sender_id === user?.user_id;
          const isAdmin = m.sender_role === "admin";
          return (
            <View key={m.message_id} style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
              {isAdmin && !isMe && (
                <View style={styles.adminTag}>
                  <Icon name="shield-check" size={11} color={colors.onBrandPrimary} />
                  <Text style={styles.adminTagText}>SPIKE Support</Text>
                </View>
              )}
              <Text style={{ color: isMe ? colors.onBrandPrimary : colors.onSurface }}>{m.body}</Text>
            </View>
          );
        })}
      </ScrollView>
      {err && <Text style={{ color: colors.error, textAlign: "center", marginBottom: 6 }}>{err}</Text>}
      <View style={styles.inputRow}>
        <TextInput testID="support-input" value={msg} onChangeText={setMsg} placeholder="Type your message…" placeholderTextColor={colors.muted} style={styles.input} multiline />
        <Pressable testID="support-send" onPress={send} disabled={busy || !msg.trim()} style={[styles.sendBtn, (!msg.trim() || busy) && { opacity: 0.5 }]}>
          <Icon name="send" size={18} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "800", color: colors.onSurface, marginTop: 6 },
  sub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  headerBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.brandPrimary },
  headerBadgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: 6 },
  emptyText: { color: colors.muted, textAlign: "center", fontSize: 13, maxWidth: 260 },
  bubble: { padding: 12, borderRadius: 16, maxWidth: "82%" },
  bubbleMe: { backgroundColor: colors.brandPrimary, alignSelf: "flex-end" },
  bubbleThem: { backgroundColor: colors.surfaceSecondary, alignSelf: "flex-start" },
  adminTag: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6, alignSelf: "flex-start", backgroundColor: colors.brandPrimary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  adminTagText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, alignItems: "flex-end" },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.onSurface, maxHeight: 100, minHeight: 44 },
  sendBtn: { backgroundColor: colors.brandPrimary, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
