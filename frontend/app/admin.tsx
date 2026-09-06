import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"stats" | "users" | "support">("stats");
  const [convoUser, setConvoUser] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => api<any>("/admin/stats") });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<{ users: any[] }>("/admin/users") });
  const supportConvos = useQuery({
    queryKey: ["admin-support"],
    queryFn: () => api<{ conversations: any[] }>("/admin/support"),
    enabled: tab === "support" && !convoUser,
    refetchInterval: tab === "support" && !convoUser ? 8000 : false,
  });

  const suspend = async (uid: string, suspended: boolean) => {
    await api(`/admin/users/${uid}/suspend`, { method: "POST", body: JSON.stringify({ suspended }) });
    users.refetch();
  };
  const promote = async (uid: string, role: string) => {
    await api(`/admin/users/${uid}/promote`, { method: "POST", body: JSON.stringify({ role }) });
    users.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.title}>SPIKE Admin</Text>
          <Pressable testID="admin-logout" onPress={logout} hitSlop={12}>
            <Icon name="logout" size={22} color={colors.error} />
          </Pressable>
        </View>
        <View style={styles.tabs}>
          <TabBtn label="Stats" icon="chart-box-outline" active={tab === "stats"} onPress={() => setTab("stats")} testID="tab-stats" />
          <TabBtn label="Users" icon="account-multiple" active={tab === "users"} onPress={() => setTab("users")} testID="tab-users" />
          <TabBtn label="Support" icon="lifebuoy" active={tab === "support"} onPress={() => { setTab("support"); setConvoUser(null); }} testID="tab-support" />
        </View>
      </View>

      {tab === "stats" && (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={styles.grid}>
            <Stat label="Users" value={stats.data?.users} icon="account-multiple" />
            <Stat label="Jobs" value={stats.data?.jobs} icon="clipboard-list" />
            <Stat label="Open disputes" value={stats.data?.open_disputes} icon="alert-decagram" />
            <Stat label="Commission" value={`$${(stats.data?.revenue || 0).toFixed(2)}`} icon="cash" adminOnly />
          </View>
          <Text style={styles.note}>Commission is visible to admins only. Customers see full job price; handymen see net payout.</Text>
        </ScrollView>
      )}

      {tab === "users" && (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
          <Button testID="create-admin" label="+ Add admin" onPress={() => setCreateOpen(true)} />
          {(users.data?.users || []).map((u) => (
            <View key={u.user_id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{u.legal_name || u.email}</Text>
                <Text style={styles.rowSub}>{u.email} · {u.role}</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Badge label={u.identity_status || "PENDING"} tone={u.identity_status === "VERIFIED" ? "success" : "warning"} />
                  {u.suspended && <Badge label="SUSPENDED" tone="warning" />}
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Button testID={`suspend-${u.user_id}`} small label={u.suspended ? "Unsuspend" : "Suspend"} variant={u.suspended ? "secondary" : "danger"} onPress={() => suspend(u.user_id, !u.suspended)} />
                {u.role !== "admin" && (
                  <Button testID={`promote-${u.user_id}`} small label="Make admin" variant="secondary" onPress={() => promote(u.user_id, "admin")} />
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {tab === "support" && !convoUser && (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
          {(supportConvos.data?.conversations || []).length === 0 && (
            <View style={{ alignItems: "center", padding: 30, gap: 8 }}>
              <Icon name="lifebuoy" size={40} color={colors.muted} />
              <Text style={{ color: colors.muted }}>No support conversations yet.</Text>
            </View>
          )}
          {(supportConvos.data?.conversations || []).map((c: any) => (
            <Pressable key={c.user_id} testID={`convo-${c.user_id}`} onPress={() => setConvoUser(c.user_id)} style={styles.convo}>
              <View style={styles.convoAvatar}><Text style={{ color: colors.onBrandPrimary, fontWeight: "800" }}>{(c.user_name || c.user_email || "?")[0].toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{c.user_name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{c.last_body}</Text>
              </View>
              <View style={styles.convoBadge}><Text style={styles.convoBadgeText}>{c.count}</Text></View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {tab === "support" && !!convoUser && (
        <AdminSupportConvo userId={convoUser} onBack={() => setConvoUser(null)} />
      )}

      <CreateAdminModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); setCreateOpen(false); }} />
    </View>
  );
}

function TabBtn({ label, icon, active, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Icon name={icon} size={16} color={active ? colors.onBrandPrimary : colors.onSurface} />
      <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurface, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, icon, adminOnly }: any) {
  return (
    <View style={styles.stat}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Icon name={icon} size={18} color={colors.brandPrimary} />
        {adminOnly && <Text style={styles.adminOnlyTag}>ADMIN</Text>}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: 2 }}>{value ?? "—"}</Text>
    </View>
  );
}

function AdminSupportConvo({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [msg, setMsg] = useState("");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-convo", userId],
    queryFn: () => api<{ messages: any[] }>(`/admin/support/${userId}`),
    refetchInterval: 4000,
  });
  const send = async () => {
    if (!msg.trim()) return;
    await api(`/admin/support/${userId}/reply`, { method: "POST", body: JSON.stringify({ body: msg }) });
    setMsg("");
    qc.invalidateQueries({ queryKey: ["admin-convo", userId] });
    qc.invalidateQueries({ queryKey: ["admin-support"] });
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ padding: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={onBack} testID="admin-convo-back" hitSlop={12}>
          <Icon name="chevron-left" size={22} color={colors.brandPrimary} />
        </Pressable>
        <Text style={{ marginLeft: 8, fontWeight: "700", color: colors.onSurface }}>Conversation</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {(q.data?.messages || []).map((m: any) => (
          <View key={m.message_id} style={[styles.bubble, m.sender_role === "admin" ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={{ color: m.sender_role === "admin" ? colors.onBrandPrimary : colors.onSurface }}>{m.body}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput testID="admin-reply-input" value={msg} onChangeText={setMsg} placeholder="Reply as SPIKE Support…" placeholderTextColor={colors.muted} style={styles.input} multiline />
        <Pressable testID="admin-reply-send" onPress={send} style={styles.sendBtn}>
          <Icon name="send" size={18} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function CreateAdminModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await api("/admin/users", { method: "POST", body: JSON.stringify({ email, password, legal_name: name, role: "admin" }) });
      setEmail(""); setName(""); setPassword("");
      onCreated();
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modal}>
          <View style={styles.grip} />
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.onSurface, marginBottom: 6 }}>Add admin</Text>
          <Text style={{ color: colors.muted, marginBottom: 14 }}>Create another SPIKE admin account.</Text>
          <Field label="Email" value={email} onChange={setEmail} testID="new-admin-email" />
          <Field label="Full name" value={name} onChange={setName} testID="new-admin-name" />
          <Field label="Password" value={password} onChange={setPassword} testID="new-admin-password" secure />
          {err && <Text style={{ color: colors.error, marginBottom: 8 }}>{err}</Text>}
          <Button testID="new-admin-submit" label="Create admin" onPress={submit} loading={busy} />
          <View style={{ height: 10 }} />
          <Button testID="new-admin-cancel" label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, testID, secure }: any) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", marginBottom: 6, fontSize: 13 }}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} autoCapitalize={secure ? "none" : "sentences"} secureTextEntry={secure} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  tabs: { flexDirection: "row", gap: 6, marginTop: 12 },
  tabBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surfaceSecondary },
  tabBtnActive: { backgroundColor: colors.brandPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "48%", padding: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 14 },
  adminOnlyTag: { color: colors.warning, fontSize: 9, fontWeight: "800", letterSpacing: 0.6, backgroundColor: "#FBE8CF", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  note: { color: colors.muted, fontSize: 12, marginTop: 16, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  rowName: { fontWeight: "700", color: colors.onSurface },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  convo: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 12 },
  convoAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  convoBadge: { minWidth: 26, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  convoBadgeText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11 },
  bubble: { padding: 10, borderRadius: 14, maxWidth: "82%" },
  bubbleMe: { backgroundColor: colors.brandPrimary, alignSelf: "flex-end" },
  bubbleThem: { backgroundColor: colors.surfaceSecondary, alignSelf: "flex-start" },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, alignItems: "flex-end" },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.onSurface, minHeight: 44, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn: { backgroundColor: colors.brandPrimary, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 10, maxHeight: "88%" },
  grip: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 12 },
});
