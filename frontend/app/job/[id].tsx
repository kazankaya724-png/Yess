import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const STATE_ORDER = [
  "POSTED", "CLAIMED", "BOOKED", "HANDYMAN_ON_WAY", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CUSTOMER_APPROVED", "PAYMENT_RELEASED",
];

export default function JobDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"details" | "chat">("details");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const jobQ = useQuery({ queryKey: ["job", id], queryFn: () => api<{ job: any }>(`/jobs/${id}`), enabled: !!id });
  const evQ = useQuery({ queryKey: ["job-ev", id], queryFn: () => api<{ events: any[] }>(`/jobs/${id}/events`), enabled: !!id });
  const msgQ = useQuery({
    queryKey: ["job-msg", id],
    queryFn: () => api<{ messages: any[] }>(`/jobs/${id}/messages`),
    enabled: !!id && tab === "chat",
    refetchInterval: tab === "chat" ? 3000 : false,
  });

  const job = jobQ.data?.job;
  const isCustomer = user?.role === "customer" && user?.user_id === job?.customer_id;
  const isHandyman = user?.role === "handyman";
  const isMyBooking = isHandyman && user?.user_id === job?.handyman_id;
  const canClaim = isHandyman && !job?.handyman_id && ["POSTED", "MATCHING_30MI", "MATCHING_60MI"].includes(job?.status);

  const doAction = async (path: string, body: any = null) => {
    setBusy(true); setErr(null);
    try {
      await api(`/jobs/${id}${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await qc.invalidateQueries({ queryKey: ["job", id] });
      await qc.invalidateQueries({ queryKey: ["job-ev", id] });
      await qc.invalidateQueries({ queryKey: ["available-jobs"] });
      await qc.invalidateQueries({ queryKey: ["hm-jobs"] });
      await qc.invalidateQueries({ queryKey: ["my-jobs"] });
    } catch (e: any) { setErr(e.message || "Action failed"); }
    finally { setBusy(false); }
  };

  const send = async () => {
    if (!msg.trim()) return;
    try {
      await api(`/jobs/${id}/messages`, { method: "POST", body: JSON.stringify({ body: msg }) });
      setMsg("");
      await qc.invalidateQueries({ queryKey: ["job-msg", id] });
    } catch (e: any) { setErr(e.message); }
  };

  if (jobQ.isLoading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.brandPrimary} /></View>;
  if (!job) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text>Job not found</Text></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable testID="job-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary, marginBottom: 8 }}>← Back</Text></Pressable>
        <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Badge label={job.status.replace(/_/g, " ")} tone="brand" testID="job-status" />
          {job.urgency === "emergency" && <Badge label="EMERGENCY" tone="warning" />}
          {job.address_released ? <Badge label="ADDRESS RELEASED" tone="success" /> : <Badge label="ADDRESS PRIVATE" tone="muted" />}
        </View>
        <View style={{ flexDirection: "row", marginTop: 12, gap: 4 }}>
          <TabBtn active={tab === "details"} label="Details" onPress={() => setTab("details")} testID="tab-details" />
          <TabBtn active={tab === "chat"} label="Chat" onPress={() => setTab("chat")} testID="tab-chat" />
        </View>
      </View>

      {tab === "details" ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={jobQ.isRefetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["job", id] })} />}>
          <View style={styles.card}>
            <Row k="Price" v={`$${Number(job.price).toFixed(0)}`} />
            <Row k="Category" v={job.category} />
            <Row k="When" v={`${job.date}  ${job.start_time}–${job.end_time}`} />
            <Row k="ZIP" v={job.zip_area || job.zip_code} />
            {job.exact_address ? (
              <Row k="Address" v={job.exact_address} />
            ) : (
              <Row k="Address" v="🔒 Released 24h before job" />
            )}
          </View>

          <Text style={styles.section}>Description</Text>
          <Text style={styles.desc}>{job.description || "—"}</Text>

          <Text style={styles.section}>Timeline</Text>
          <View style={{ gap: 6 }}>
            {STATE_ORDER.map((s) => {
              const passed = STATE_ORDER.indexOf(job.status) >= STATE_ORDER.indexOf(s);
              const current = job.status === s;
              return (
                <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[styles.dot, passed ? { backgroundColor: colors.brandPrimary } : { backgroundColor: colors.border }]} />
                  <Text style={{ color: passed ? colors.onSurface : colors.muted, fontWeight: current ? "700" : "500" }}>{s.replace(/_/g, " ")}</Text>
                </View>
              );
            })}
          </View>

          {err && <Text style={{ color: colors.error, marginTop: 12 }}>{err}</Text>}

          <View style={{ marginTop: 20, gap: 10 }}>
            {/* Handyman actions */}
            {canClaim && (
              <Button testID="claim-btn" label="Claim this job" loading={busy} onPress={() => doAction("/claim")} />
            )}
            {isMyBooking && job.status === "BOOKED" && (
              <Button testID="onway-btn" label="I'm on my way" onPress={() => doAction("/on-way")} loading={busy} />
            )}
            {isMyBooking && (job.status === "BOOKED" || job.status === "HANDYMAN_ON_WAY") && job.address_released && (
              <Button testID="arrive-btn" label="Mark arrived (GPS)" onPress={() => doAction("/arrive", { lat: 32.744, lng: -117.09 })} loading={busy} />
            )}
            {isMyBooking && job.status === "ARRIVED" && (
              <>
                <Button testID="upload-before" label="Upload BEFORE photo (demo)" variant="secondary" onPress={() => api(`/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ kind: "before", photos: ["demo_before"] }) }).then(() => qc.invalidateQueries({ queryKey: ["job", id] }))} />
                <Button testID="start-btn" label="Start job" onPress={() => doAction("/start")} loading={busy} />
              </>
            )}
            {isMyBooking && job.status === "IN_PROGRESS" && (
              <>
                <Button testID="upload-after" label="Upload AFTER photo (demo)" variant="secondary" onPress={() => api(`/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ kind: "after", photos: ["demo_after"] }) }).then(() => qc.invalidateQueries({ queryKey: ["job", id] }))} />
                <Button testID="complete-btn" label="Complete job" onPress={() => doAction("/complete")} loading={busy} />
              </>
            )}

            {/* Customer actions */}
            {isCustomer && job.status === "CLAIMED" && (
              <>
                <Button testID="book-btn" label="Confirm & Book" onPress={() => doAction("/book")} loading={busy} />
                <Button testID="reject-btn" label="Reject claim" variant="ghost" onPress={() => doAction("/reject-claim")} loading={busy} />
              </>
            )}
            {isCustomer && job.status === "COMPLETED" && (
              <>
                <Button testID="approve-btn" label="Approve & release payment" onPress={() => doAction("/approve")} loading={busy} />
                <Button testID="dispute-btn" label="Open dispute" variant="danger" onPress={() => doAction("/dispute", { category: "Work incomplete", description: "Customer opened dispute", evidence: [] })} loading={busy} />
              </>
            )}
            {(isCustomer || isMyBooking) && !["COMPLETED", "CUSTOMER_APPROVED", "PAYMENT_RELEASED", "CANCELLED"].includes(job.status) && (
              <Button testID="cancel-btn" label="Cancel job" variant="ghost" onPress={() => doAction("/cancel")} loading={busy} />
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
            {(msgQ.data?.messages || []).map((m) => (
              <View key={m.message_id} style={[styles.bubble, m.sender_id === user?.user_id ? styles.bubbleMe : styles.bubbleThem]}>
                <Text style={{ color: m.sender_id === user?.user_id ? colors.onBrandPrimary : colors.onSurface }}>{m.body}</Text>
                {m.flagged_off_platform && <Text style={{ color: colors.warning, fontSize: 11, marginTop: 4 }}>⚠ Off-platform payment attempts violate SPIKE policy.</Text>}
              </View>
            ))}
            {(msgQ.data?.messages || []).length === 0 && <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>Say hello 👋</Text>}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TextInput testID="chat-input" value={msg} onChangeText={setMsg} placeholder="Message…" placeholderTextColor={colors.muted} style={styles.chatInput} />
            <Pressable testID="chat-send" onPress={send} style={styles.sendBtn}><Text style={{ color: colors.onBrandPrimary, fontWeight: "700" }}>Send</Text></Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function TabBtn({ active, label, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.tabBtn, active && { backgroundColor: colors.brandPrimary }]}>
      <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}
function Row({ k, v }: any) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}><Text style={{ color: colors.muted }}>{k}</Text><Text style={{ color: colors.onSurface, fontWeight: "600", flex: 1, textAlign: "right", marginLeft: 12 }} numberOfLines={2}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 14 },
  section: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: 20, marginBottom: 8 },
  desc: { color: colors.onSurfaceSecondary, lineHeight: 20 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tabBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.surfaceSecondary },
  bubble: { padding: 12, borderRadius: 16, maxWidth: "80%" },
  bubbleMe: { backgroundColor: colors.brandPrimary, alignSelf: "flex-end" },
  bubbleThem: { backgroundColor: colors.surfaceSecondary, alignSelf: "flex-start" },
  chatInputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  chatInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.onSurface },
  sendBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
