import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/material-design-icons";

import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { pickAndUpload } from "@/src/upload";
import { VerifiedBadge } from "@/src/verified-badge";
import { RatingPrompt } from "@/src/rating-prompt";
import { PrivacyAreaCard } from "@/src/privacy-area-card";

const STATE_LABELS: Record<string, { title: string; sub: string; icon: string; tone: "brand" | "success" | "warning" }> = {
  POSTED: { title: "Awaiting a pro", sub: "We're matching nearby verified handymen.", icon: "magnify", tone: "brand" },
  MATCHING_30MI: { title: "Matching in 30 mi", sub: "Notifying pros nearby.", icon: "map-marker-radius", tone: "brand" },
  MATCHING_60MI: { title: "Expanded to 60 mi", sub: "Reaching more pros in your region.", icon: "map-marker-radius", tone: "brand" },
  CLAIMED: { title: "A pro claimed your job", sub: "Review & book to confirm.", icon: "hand-wave", tone: "brand" },
  BOOKED: { title: "Booked", sub: "Address unlocks 24h before start.", icon: "calendar-check", tone: "success" },
  HANDYMAN_ON_WAY: { title: "Pro is on the way", sub: "Live status updates enabled.", icon: "car", tone: "brand" },
  ARRIVED: { title: "Pro has arrived", sub: "Job can begin shortly.", icon: "map-marker-check", tone: "brand" },
  IN_PROGRESS: { title: "Work in progress", sub: "Before-photos uploaded. Awaiting completion.", icon: "progress-wrench", tone: "brand" },
  COMPLETED: { title: "Marked complete", sub: "Please review and approve.", icon: "check-circle-outline", tone: "success" },
  CUSTOMER_APPROVED: { title: "Approved by you", sub: "Payment is being released.", icon: "thumb-up", tone: "success" },
  PAYMENT_RELEASED: { title: "All done", sub: "Payout complete. Thanks!", icon: "check-decagram", tone: "success" },
  DISPUTED: { title: "Dispute open", sub: "Our team is reviewing.", icon: "alert-circle-outline", tone: "warning" },
  CANCELLED: { title: "Cancelled", sub: "This job is no longer active.", icon: "close-circle-outline", tone: "warning" },
  EXPIRED: { title: "Expired", sub: "Job timed out without a match.", icon: "timer-sand-empty", tone: "warning" },
};

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
  const chatStatusQ = useQuery({
    queryKey: ["chat-status", id],
    queryFn: () => api<{ allowed: boolean; reason: string; address_release_at: string | null }>(`/jobs/${id}/chat-status`),
    enabled: !!id, refetchInterval: 30_000,
  });
  const msgQ = useQuery({
    queryKey: ["job-msg", id],
    queryFn: () => api<{ messages: any[] }>(`/jobs/${id}/messages`),
    enabled: !!id && tab === "chat" && (chatStatusQ.data?.allowed ?? false),
    refetchInterval: tab === "chat" ? 4000 : false,
  });
  const reviewsQ = useQuery({
    queryKey: ["job-reviews", id],
    queryFn: () => api<{ reviews: any[]; can_rate: boolean }>(`/jobs/${id}/reviews`),
    enabled: !!id,
  });
  const etaQ = useQuery({
    queryKey: ["job-eta", id],
    queryFn: () => api<{ available: boolean; distance_miles?: number; minutes?: number; urgency?: string }>(`/jobs/${id}/eta`),
    enabled: !!id,
    refetchInterval: 30_000,
  });
  const [rateOpen, setRateOpen] = useState(false);
  const [rateShown, setRateShown] = useState(false);
  useEffect(() => {
    if (!rateShown && reviewsQ.data?.can_rate) {
      setRateShown(true);
      setRateOpen(true);
    }
  }, [reviewsQ.data?.can_rate, rateShown]);

  const job = jobQ.data?.job;
  const isCustomer = user?.role === "customer" && user?.user_id === job?.customer_id;
  const isHandyman = user?.role === "handyman";
  const isMyBooking = isHandyman && user?.user_id === job?.handyman_id;
  const canClaim = isHandyman && !job?.handyman_id && ["POSTED", "MATCHING_30MI", "MATCHING_60MI"].includes(job?.status);
  const chatAllowed = chatStatusQ.data?.allowed ?? false;
  const chatReason = chatStatusQ.data?.reason || "";

  const doAction = async (path: string, body: any = null) => {
    setBusy(true); setErr(null);
    try {
      await api(`/jobs/${id}${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await qc.invalidateQueries({ queryKey: ["job", id] });
      await qc.invalidateQueries({ queryKey: ["chat-status", id] });
      await qc.invalidateQueries({ queryKey: ["available-jobs"] });
      await qc.invalidateQueries({ queryKey: ["hm-jobs"] });
      await qc.invalidateQueries({ queryKey: ["my-jobs"] });
    } catch (e: any) { setErr(e.message || "Action failed"); }
    finally { setBusy(false); }
  };

  const uploadPhoto = async (kind: "before" | "after", source: "camera" | "library") => {
    setBusy(true); setErr(null);
    try {
      const path = await pickAndUpload(source);
      if (!path) return;
      await api(`/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ kind, photos: [path] }) });
      await qc.invalidateQueries({ queryKey: ["job", id] });
    } catch (e: any) { setErr(e.message || "Upload failed"); }
    finally { setBusy(false); }
  };

  const uploadJobPhoto = async (source: "camera" | "library") => {
    setBusy(true); setErr(null);
    try {
      const path = await pickAndUpload(source);
      if (!path) return;
      await api(`/jobs/${id}/photos`, { method: "POST", body: JSON.stringify({ kind: "post", photos: [path] }) });
      await qc.invalidateQueries({ queryKey: ["job", id] });
    } catch (e: any) { setErr(e.message || "Upload failed"); }
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

  const statusInfo = STATE_LABELS[job.status] || { title: job.status, sub: "", icon: "information", tone: "brand" as const };
  const statusBg = statusInfo.tone === "success" ? colors.brandTertiary : statusInfo.tone === "warning" ? "#FBE8CF" : colors.surfaceSecondary;
  const statusFg = statusInfo.tone === "success" ? colors.success : statusInfo.tone === "warning" ? colors.warning : colors.brandPrimary;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable testID="job-back" onPress={() => router.back()} hitSlop={12}>
            <Icon name="chevron-left" size={26} color={colors.brandPrimary} />
          </Pressable>
          {chatAllowed && (
            <Pressable testID="chat-icon" onPress={() => setTab("chat")} hitSlop={12} style={styles.chatIconBtn}>
              <Icon name="message-processing-outline" size={22} color={colors.onBrandPrimary} />
            </Pressable>
          )}
        </View>
        <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {job.urgency === "emergency" && <Badge label="EMERGENCY" tone="warning" />}
          {job.address_released ? <Badge label="ADDRESS RELEASED" tone="success" /> : <Badge label="ADDRESS PRIVATE" tone="muted" />}
        </View>
        {chatAllowed && (
          <View style={{ flexDirection: "row", marginTop: 12, gap: 4 }}>
            <TabBtn active={tab === "details"} label="Details" onPress={() => setTab("details")} testID="tab-details" />
            <TabBtn active={tab === "chat"} label="Chat" onPress={() => setTab("chat")} testID="tab-chat" />
          </View>
        )}
      </View>

      {tab === "details" ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={jobQ.isRefetching} onRefresh={() => qc.invalidateQueries({ queryKey: ["job", id] })} />}>
          <Text style={styles.section}>Current status</Text>
          <View style={[styles.statusCard, { backgroundColor: statusBg }]} testID="current-status-card">
            <View style={[styles.statusIconWrap, { backgroundColor: statusFg }]}>
              <Icon name={statusInfo.icon as any} size={22} color={colors.onBrandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: statusFg }]}>{statusInfo.title}</Text>
              {!!statusInfo.sub && <Text style={styles.statusSub}>{statusInfo.sub}</Text>}
            </View>
          </View>

          {job.status === "HANDYMAN_ON_WAY" && etaQ.data?.available && (
            <View style={styles.etaCard} testID="eta-card">
              <View style={[styles.etaIconWrap, { backgroundColor: job.urgency === "emergency" ? colors.error : colors.brandPrimary }]}>
                <Icon name="car" size={20} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.etaTitle}>Arriving in ~{etaQ.data.minutes} min</Text>
                <Text style={styles.etaSub}>{etaQ.data.distance_miles} mi away · updates live</Text>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <Row k="Price" v={`$${Number(job.price).toFixed(0)}`} />
            <Row k="Category" v={job.category} />
            <Row k="When" v={`${job.date}  ${job.start_time}–${job.end_time}`} />
            <Row k="ZIP" v={job.zip_area || job.zip_code} />
            {job.exact_address ? (
              <Row k="Address" v={job.exact_address} />
            ) : (
              <Row k="Address" v="🔒 Unlocks 24h before start" />
            )}
          </View>

          {!job.exact_address && (
            <>
              <Text style={styles.section}>Approximate service area</Text>
              <PrivacyAreaCard
                city={job.city}
                state={job.state}
                zip={job.zip_area || job.zip_code}
                radiusMeters={job.privacy_radius_meters || 500}
              />
            </>
          )}

          <Text style={styles.section}>Description</Text>
          <Text style={styles.desc}>{job.description || "—"}</Text>

          {(job.photos_before?.length > 0 || job.photos_after?.length > 0 || job.photos?.length > 0) && (
            <>
              <Text style={styles.section}>Photos</Text>
              <View style={styles.photoGrid}>
                {(job.photos || []).map((p: string, i: number) => <PhotoTile key={`p${i}`} path={p} label="POST" />)}
                {(job.photos_before || []).map((p: any, i: number) => <PhotoTile key={`b${i}`} path={p.data || p} label="BEFORE" />)}
                {(job.photos_after || []).map((p: any, i: number) => <PhotoTile key={`a${i}`} path={p.data || p} label="AFTER" />)}
              </View>
            </>
          )}

          {err && <Text style={{ color: colors.error, marginTop: 12 }}>{err}</Text>}

          {(reviewsQ.data?.reviews || []).length > 0 && (
            <>
              <Text style={styles.section}>Ratings</Text>
              <View style={{ gap: 10 }}>
                {(reviewsQ.data?.reviews || []).map((r: any) => (
                  <View key={r.review_id} style={styles.reviewCard}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={styles.reviewName}>{r.reviewer_name} → {r.reviewer_role === "customer" ? "Handyman" : "Customer"}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        <Icon name="star" size={14} color={colors.warning} />
                        <Text style={styles.reviewRating}>{Number(r.rating).toFixed(1)}</Text>
                      </View>
                    </View>
                    {!!r.comment && <Text style={styles.reviewComment}>&ldquo;{r.comment}&rdquo;</Text>}
                    {(r.photos || []).length > 0 && (
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {(r.photos || []).map((p: string, i: number) => (
                          <Image
                            key={i}
                            source={{ uri: p.startsWith("http") ? p : `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/files/${p}` }}
                            style={styles.reviewPhoto}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          {reviewsQ.data?.can_rate && (
            <View style={{ marginTop: 16 }}>
              <Button testID="open-rating" label={`Rate this ${user?.role === "customer" ? "handyman" : "customer"}`} onPress={() => setRateOpen(true)} />
            </View>
          )}

          <View style={{ marginTop: 20, gap: 10 }}>
            {canClaim && <Button testID="claim-btn" label="Claim this job" loading={busy} onPress={() => doAction("/claim")} />}
            {isMyBooking && job.status === "BOOKED" && <Button testID="onway-btn" label="I'm on my way" onPress={() => doAction("/on-way")} loading={busy} />}
            {isMyBooking && (job.status === "BOOKED" || job.status === "HANDYMAN_ON_WAY") && job.address_released && (
              <Button testID="arrive-btn" label="Mark arrived (GPS)" onPress={() => doAction("/arrive", { lat: 32.744, lng: -117.09 })} loading={busy} />
            )}
            {isMyBooking && job.status === "ARRIVED" && (
              <>
                <PhotoUploadRow testID="before" label="Before photo" onPick={(s) => uploadPhoto("before", s)} count={job.photos_before?.length || 0} />
                <Button testID="start-btn" label="Start job" onPress={() => doAction("/start")} loading={busy} />
              </>
            )}
            {isMyBooking && job.status === "IN_PROGRESS" && (
              <>
                <PhotoUploadRow testID="after" label="After photo" onPick={(s) => uploadPhoto("after", s)} count={job.photos_after?.length || 0} />
                <Button testID="complete-btn" label="Complete job" onPress={() => doAction("/complete")} loading={busy} />
              </>
            )}
            {isCustomer && job.status === "CLAIMED" && (
              <>
                <Button testID="book-btn" label="Confirm & Book" onPress={() => doAction("/book")} loading={busy} />
                <Button testID="reject-btn" label="Reject claim" variant="ghost" onPress={() => doAction("/reject-claim")} loading={busy} />
              </>
            )}
            {isCustomer && job.status === "COMPLETED" && (
              <>
                <Button testID="approve-btn" label="Approve completion" onPress={() => doAction("/approve")} loading={busy} />
                <Button testID="dispute-btn" label="Open dispute" variant="danger" onPress={() => doAction("/dispute", { category: "Work incomplete", description: "Customer opened dispute", evidence: [] })} loading={busy} />
              </>
            )}
            {(isCustomer || isMyBooking) && !["COMPLETED", "CUSTOMER_APPROVED", "PAYMENT_RELEASED", "CANCELLED", "DISPUTED"].includes(job.status) && (
              <Button testID="cancel-btn" label="Cancel job" variant="ghost" onPress={() => doAction("/cancel")} loading={busy} />
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {chatAllowed ? (
            <>
              <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
                {(msgQ.data?.messages || []).map((m) => (
                  <View key={m.message_id} style={[styles.bubble, m.sender_id === user?.user_id ? styles.bubbleMe : styles.bubbleThem]}>
                    <Text style={{ color: m.sender_id === user?.user_id ? colors.onBrandPrimary : colors.onSurface }}>{m.body}</Text>
                    {m.flagged_off_platform && <Text style={{ color: colors.warning, fontSize: 11, marginTop: 4 }}>⚠ Off-platform payment attempts violate SPIKE policy.</Text>}
                  </View>
                ))}
                {(msgQ.data?.messages || []).length === 0 && <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>Say hello 👋</Text>}
                <View style={styles.chatNotice}>
                  <Icon name="shield-lock-outline" size={14} color={colors.muted} />
                  <Text style={styles.chatNoticeText}>Phone numbers, emails, and addresses are blocked. Keep it in SPIKE.</Text>
                </View>
              </ScrollView>
              <View style={styles.chatInputRow}>
                <TextInput testID="chat-input" value={msg} onChangeText={setMsg} placeholder="Message…" placeholderTextColor={colors.muted} style={styles.chatInput} />
                <Pressable testID="chat-send" onPress={send} style={styles.sendBtn}>
                  <Icon name="send" size={18} color={colors.onBrandPrimary} />
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.chatLocked}>
              <Icon name="lock-clock" size={48} color={colors.muted} />
              <Text style={styles.chatLockedTitle}>Chat locked</Text>
              <Text style={styles.chatLockedText}>{chatReason}</Text>
            </View>
          )}
        </View>
      )}
      <RatingPrompt
        visible={rateOpen}
        jobId={String(id)}
        jobTitle={job?.title || ""}
        reviewerRole={(user?.role as any) || "customer"}
        onClose={() => setRateOpen(false)}
        onSubmitted={() => { qc.invalidateQueries({ queryKey: ["job-reviews", id] }); }}
      />
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
  return <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
    <Text style={{ color: colors.muted }}>{k}</Text>
    <Text style={{ color: colors.onSurface, fontWeight: "600", flex: 1, textAlign: "right", marginLeft: 12 }} numberOfLines={2}>{v}</Text>
  </View>;
}

function PhotoTile({ path, label }: { path: string; label: string }) {
  const url = path?.startsWith?.("http") ? path : `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/files/${path}`;
  return (
    <View style={styles.photoTile}>
      <Image source={{ uri: url }} style={styles.photoImg} />
      <View style={styles.photoLabel}><Text style={styles.photoLabelText}>{label}</Text></View>
    </View>
  );
}

function PhotoUploadRow({ label, onPick, count, testID }: any) {
  return (
    <View style={styles.photoUploadRow}>
      <Text style={{ color: colors.onSurface, fontWeight: "700", flex: 1 }}>{label} · {count} uploaded</Text>
      <Pressable testID={`${testID}-camera`} onPress={() => onPick("camera")} style={styles.photoBtn}>
        <Icon name="camera" size={18} color={colors.onBrandPrimary} />
      </Pressable>
      <Pressable testID={`${testID}-library`} onPress={() => onPick("library")} style={[styles.photoBtn, { backgroundColor: colors.brandSecondary }]}>
        <Icon name="image-multiple" size={18} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  chatIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 14 },
  section: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: 20, marginBottom: 8 },
  desc: { color: colors.onSurfaceSecondary, lineHeight: 20 },
  statusCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, gap: 12 },
  statusIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 16, fontWeight: "800" },
  statusSub: { color: colors.onSurfaceSecondary, marginTop: 2, fontSize: 13 },
  tabBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.surfaceSecondary },
  bubble: { padding: 12, borderRadius: 16, maxWidth: "80%" },
  bubbleMe: { backgroundColor: colors.brandPrimary, alignSelf: "flex-end" },
  bubbleThem: { backgroundColor: colors.surfaceSecondary, alignSelf: "flex-start" },
  chatInputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  chatInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.onSurface },
  sendBtn: { backgroundColor: colors.brandPrimary, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  chatLocked: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  chatLockedTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginTop: 6 },
  chatLockedText: { color: colors.muted, textAlign: "center", fontSize: 14 },
  chatNotice: { flexDirection: "row", gap: 6, alignItems: "center", padding: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 10, marginTop: 8 },
  chatNoticeText: { fontSize: 11, color: colors.muted, flex: 1 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoTile: { width: 96, height: 96, borderRadius: 12, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  photoImg: { width: "100%", height: "100%" },
  photoLabel: { position: "absolute", left: 6, top: 6, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  photoLabelText: { color: "#FFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  photoUploadRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  photoBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  etaCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, gap: 12, backgroundColor: colors.brandTertiary, marginTop: 10 },
  etaIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  etaTitle: { fontWeight: "800", color: colors.onBrandTertiary, fontSize: 16 },
  etaSub: { color: colors.onBrandTertiary, opacity: 0.75, fontSize: 12, marginTop: 2 },
  reviewCard: { padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 12 },
  reviewName: { fontWeight: "700", color: colors.onSurface, fontSize: 13, flex: 1, marginRight: 8 },
  reviewRating: { fontWeight: "800", color: colors.onSurface, fontSize: 13 },
  reviewComment: { color: colors.onSurfaceSecondary, fontStyle: "italic", marginTop: 6, fontSize: 13 },
  reviewPhoto: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
});
