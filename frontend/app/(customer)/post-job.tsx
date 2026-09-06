import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/material-design-icons";

import { colors } from "@/src/theme";
import { Button } from "@/src/ui";
import { api } from "@/src/api";
import { pickAndUpload } from "@/src/upload";

export default function PostJob() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => api<{ categories: any[] }>("/config") });

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>((params.category as string) || "");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("17:00");
  const [zip, setZip] = useState("");
  const [address, setAddress] = useState("");
  const [urgency, setUrgency] = useState<"standard" | "emergency">("standard");
  const [instructions, setInstructions] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date = tomorrow (yyyy-mm-dd)
  React.useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    setDate(d.toISOString().slice(0, 10));
  }, []);

  const submit = async () => {
    setError(null);
    try {
      setSubmitting(true);
      const r = await api<{ job: any }>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          title, category, description,
          price: parseFloat(price) || 0,
          date, start_time: startTime, end_time: endTime,
          zip_code: zip, exact_address: address,
          special_instructions: instructions, required_skills: [], urgency,
          photos,
        }),
      });
      router.replace({ pathname: "/job/[id]", params: { id: r.job.job_id } });
    } catch (e: any) {
      setError(e.message || "Failed to post job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable testID="close-post-job" onPress={() => router.back()}>
          <Text style={{ color: colors.brandPrimary, fontSize: 15, marginBottom: 12 }}>← Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Post a Job</Text>
        <Text style={styles.step}>Step {step} of 3</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${step * 33.3}%` }]} />
        </View>

        {step === 1 && (
          <>
            <Field label="Job title" value={title} onChange={setTitle} testID="pj-title" placeholder="e.g. TV Mounting" />
            <Text style={styles.label}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4, marginBottom: 12 }}>
              {(cfg.data?.categories || []).map((c: any) => (
                <Pressable key={c.id} testID={`pj-cat-${c.id}`} onPress={() => setCategory(c.id)} style={[styles.catChip, category === c.id && styles.catChipActive]}>
                  <Text style={[styles.catText, category === c.id && { color: colors.onBrandPrimary }]}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Field label="Description" value={description} onChange={setDescription} testID="pj-desc" multiline />
            <View style={styles.urgencyRow}>
              <UrgencyChip label="Standard" active={urgency === "standard"} onPress={() => setUrgency("standard")} testID="pj-urg-std" />
              <UrgencyChip label="Emergency / ASAP" active={urgency === "emergency"} onPress={() => setUrgency("emergency")} testID="pj-urg-emerg" />
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Field label="Proposed price ($)" value={price} onChange={setPrice} testID="pj-price" keyboardType="decimal-pad" />
            <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} testID="pj-date" />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Start (HH:mm)" value={startTime} onChange={setStartTime} testID="pj-start" /></View>
              <View style={{ flex: 1 }}><Field label="End (HH:mm)" value={endTime} onChange={setEndTime} testID="pj-end" /></View>
            </View>
            <Field label="ZIP code" value={zip} onChange={setZip} testID="pj-zip" keyboardType="number-pad" />
            <Field label="Exact address (private)" value={address} onChange={setAddress} testID="pj-address" placeholder="Only shared 24h before job" />
            <View style={styles.privacyBanner}>
              <Text style={styles.privacyText}>🔒 Your exact address stays hidden until 24 hours before job start.</Text>
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.label}>Photos (optional)</Text>
            <View style={styles.photoRow}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoTile}>
                  <Image source={{ uri: p.startsWith("http") ? p : `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/files/${p}` }} style={{ width: "100%", height: "100%" }} />
                  <Pressable onPress={() => setPhotos(photos.filter((_, ix) => ix !== i))} style={styles.photoRemove}>
                    <Icon name="close" size={14} color="#FFF" />
                  </Pressable>
                </View>
              ))}
              <Pressable
                testID="pj-add-photo-camera"
                onPress={async () => { const p = await pickAndUpload("camera"); if (p) setPhotos([...photos, p]); }}
                style={styles.photoAdd}
              >
                <Icon name="camera-plus-outline" size={24} color={colors.brandPrimary} />
                <Text style={styles.photoAddLabel}>Camera</Text>
              </Pressable>
              <Pressable
                testID="pj-add-photo-library"
                onPress={async () => { const p = await pickAndUpload("library"); if (p) setPhotos([...photos, p]); }}
                style={styles.photoAdd}
              >
                <Icon name="image-plus" size={24} color={colors.brandPrimary} />
                <Text style={styles.photoAddLabel}>Gallery</Text>
              </Pressable>
            </View>

            <Field label="Special instructions (optional)" value={instructions} onChange={setInstructions} testID="pj-instr" multiline />
            <Text style={styles.reviewTitle}>Review</Text>
            <View style={styles.reviewCard}>
              <Row k="Title" v={title} />
              <Row k="Category" v={cfg.data?.categories.find((c: any) => c.id === category)?.name || category} />
              <Row k="Price" v={`$${price || 0}`} />
              <Row k="When" v={`${date}  ${startTime}–${endTime}`} />
              <Row k="ZIP" v={zip} />
              <Row k="Urgency" v={urgency} />
              <Row k="Photos" v={String(photos.length)} />
            </View>
          </>
        )}

        {error && <Text testID="pj-error" style={styles.error}>{error}</Text>}

        <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
          {step > 1 && <View style={{ flex: 1 }}><Button testID="pj-prev" label="Back" variant="secondary" onPress={() => setStep(s => s - 1)} /></View>}
          {step < 3 && <View style={{ flex: 1 }}><Button testID="pj-next" label="Next" onPress={() => setStep(s => s + 1)} /></View>}
          {step === 3 && <View style={{ flex: 1 }}><Button testID="pj-submit" label="Post Job" onPress={submit} loading={submitting} /></View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, testID, keyboardType, multiline, placeholder }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && { minHeight: 90, textAlignVertical: "top", paddingTop: 12 }]}
      />
    </View>
  );
}

function UrgencyChip({ label, active, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.urgChip, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
      <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurface, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function Row({ k, v }: any) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Text style={{ color: colors.muted }}>{k}</Text>
      <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 4 },
  step: { color: colors.muted, marginBottom: 10 },
  progressBar: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 999, marginBottom: 20, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.brandPrimary, borderRadius: 999 },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 16, color: colors.onSurface, borderWidth: 1, borderColor: colors.border,
  },
  catChip: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 999, flexShrink: 0, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catText: { color: colors.onSurface, fontWeight: "600" },
  urgencyRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  urgChip: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  privacyBanner: { backgroundColor: colors.brandTertiary, padding: 12, borderRadius: 12, marginTop: 4 },
  privacyText: { color: colors.onBrandTertiary, fontSize: 13, fontWeight: "600" },
  reviewTitle: { fontSize: 16, fontWeight: "700", marginTop: 8, marginBottom: 8, color: colors.onSurface },
  reviewCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 14 },
  error: { color: colors.error, marginTop: 12 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  photoTile: { width: 84, height: 84, borderRadius: 12, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  photoRemove: { position: "absolute", right: 4, top: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  photoAdd: { width: 84, height: 84, borderRadius: 12, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", borderStyle: "dashed" },
  photoAddLabel: { fontSize: 11, color: colors.brandPrimary, fontWeight: "700", marginTop: 4 },
});
