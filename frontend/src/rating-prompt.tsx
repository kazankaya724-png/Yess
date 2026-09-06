import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";
import { Button } from "@/src/ui";
import { api } from "@/src/api";
import { pickAndUpload } from "@/src/upload";

const CUSTOMER_CATS = [
  { id: "quality", label: "Quality of Work" },
  { id: "communication", label: "Communication" },
  { id: "professionalism", label: "Professionalism" },
  { id: "on_time", label: "On-Time" },
  { id: "cleanliness", label: "Cleanliness" },
];
const HANDYMAN_CATS = [
  { id: "accurate", label: "Accurate Job Description" },
  { id: "communication", label: "Communication" },
  { id: "availability", label: "Availability" },
  { id: "respect", label: "Respect" },
  { id: "payment", label: "Payment Reliability" },
];

export function RatingPrompt({
  visible,
  jobId,
  jobTitle,
  reviewerRole,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  jobId: string;
  jobTitle: string;
  reviewerRole: "customer" | "handyman";
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const cats = reviewerRole === "customer" ? CUSTOMER_CATS : HANDYMAN_CATS;
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const avg = Object.values(scores).length
    ? Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length
    : 0;

  const submit = async () => {
    if (!avg) { setErr("Please rate at least one category"); return; }
    setBusy(true); setErr(null);
    try {
      await api(`/jobs/${jobId}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating: Math.round(avg * 10) / 10, categories: scores, comment, photos }),
      });
      onSubmitted();
      onClose();
    } catch (e: any) { setErr(e.message || "Rating failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet} testID="rating-prompt">
          <View style={styles.grip} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Rate this {reviewerRole === "customer" ? "handyman" : "customer"}</Text>
            <Text style={styles.sub} numberOfLines={1}>{jobTitle}</Text>

            <View style={styles.avgCard}>
              <Text style={styles.avgLabel}>Overall</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.avgValue}>{avg ? avg.toFixed(1) : "—"}</Text>
                <Icon name="star" size={22} color={colors.warning} />
              </View>
            </View>

            {cats.map((c) => (
              <View key={c.id} style={styles.catRow}>
                <Text style={styles.catLabel} numberOfLines={1}>{c.label}</Text>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      testID={`rate-${c.id}-${n}`}
                      onPress={() => setScores({ ...scores, [c.id]: n })}
                      hitSlop={4}
                    >
                      <Icon name={(scores[c.id] || 0) >= n ? "star" : "star-outline"}
                            size={24}
                            color={(scores[c.id] || 0) >= n ? colors.warning : colors.borderStrong} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            <Text style={styles.section}>Add photos (optional)</Text>
            <View style={styles.photoRow}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoTile}>
                  <Image source={{ uri: p.startsWith("http") ? p : `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/files/${p}` }} style={{ width: "100%", height: "100%" }} />
                  <Pressable onPress={() => setPhotos(photos.filter((_, ix) => ix !== i))} style={styles.photoRemove}>
                    <Icon name="close" size={12} color="#FFF" />
                  </Pressable>
                </View>
              ))}
              <Pressable testID="rate-add-camera" onPress={async () => { const p = await pickAndUpload("camera"); if (p) setPhotos([...photos, p]); }} style={styles.photoAdd}>
                <Icon name="camera-plus-outline" size={22} color={colors.brandPrimary} />
              </Pressable>
              <Pressable testID="rate-add-library" onPress={async () => { const p = await pickAndUpload("library"); if (p) setPhotos([...photos, p]); }} style={styles.photoAdd}>
                <Icon name="image-plus" size={22} color={colors.brandPrimary} />
              </Pressable>
            </View>

            <Text style={styles.section}>Comment</Text>
            <TextInput
              testID="rate-comment"
              value={comment}
              onChangeText={setComment}
              placeholder="Tell others what went well…"
              placeholderTextColor={colors.muted}
              multiline
              style={styles.input}
            />

            {err && <Text style={{ color: colors.error, marginTop: 8 }}>{err}</Text>}

            <View style={{ marginTop: 16, gap: 8 }}>
              <Button testID="rate-submit" label="Submit rating" onPress={submit} loading={busy} />
              <Button testID="rate-skip" label="Not now" variant="ghost" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, maxHeight: "92%" },
  grip: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginTop: 6, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  sub: { color: colors.muted, marginTop: 2, marginBottom: 12 },
  avgCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, backgroundColor: colors.brandTertiary, borderRadius: 14, marginBottom: 12 },
  avgLabel: { color: colors.onBrandTertiary, fontWeight: "700" },
  avgValue: { fontSize: 28, fontWeight: "800", color: colors.onBrandTertiary },
  catRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  catLabel: { fontSize: 14, color: colors.onSurface, fontWeight: "600", flex: 1, marginRight: 8 },
  section: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginTop: 14, marginBottom: 8 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoTile: { width: 66, height: 66, borderRadius: 10, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  photoRemove: { position: "absolute", right: 3, top: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  photoAdd: { width: 66, height: 66, borderRadius: 10, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: "top", color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
});

export default RatingPrompt;
