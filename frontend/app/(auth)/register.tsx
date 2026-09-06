import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { colors } from "@/src/theme";
import { Button } from "@/src/ui";
import { useAuth } from "@/src/auth";

export default function Register() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();
  const [role, setRole] = useState<"customer" | "handyman">("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [legalName, setLegalName] = useState("");
  const [zip, setZip] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!accepted) return setError("You must accept the terms");
    try {
      setLoading(true);
      await register({
        email: email.trim(),
        phone,
        password,
        role,
        legal_name: legalName,
        zip_code: zip,
        accept_terms: true,
      });
    } catch (e: any) {
      setError(e.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable testID="register-back" onPress={() => router.back()}>
          <Text style={{ color: colors.brandPrimary, fontSize: 15, marginBottom: 12 }}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.sub}>Registration is free.</Text>

        <Text style={styles.label}>I am a…</Text>
        <View style={styles.roleRow}>
          <RoleChip active={role === "customer"} label="Customer" onPress={() => setRole("customer")} testID="role-customer" />
          <RoleChip active={role === "handyman"} label="Handyman" onPress={() => setRole("handyman")} testID="role-handyman" />
        </View>

        <Field label="Email" value={email} onChange={setEmail} testID="reg-email" keyboardType="email-address" />
        <Field label="Phone" value={phone} onChange={setPhone} testID="reg-phone" keyboardType="phone-pad" />
        <Field label="Password" value={password} onChange={setPassword} testID="reg-password" secure />
        {role === "handyman" && <Field label="Legal name" value={legalName} onChange={setLegalName} testID="reg-name" />}
        <Field label="ZIP code" value={zip} onChange={setZip} testID="reg-zip" keyboardType="number-pad" />

        <Pressable testID="reg-accept" onPress={() => setAccepted(v => !v)} style={styles.termsRow}>
          <View style={[styles.checkbox, accepted && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
            {accepted && <Text style={{ color: colors.onBrandPrimary, fontWeight: "800" }}>✓</Text>}
          </View>
          <Text style={styles.termsText}>I agree to the SPIKE Terms and Privacy Policy.</Text>
        </Pressable>

        {error && <Text testID="reg-error" style={styles.error}>{error}</Text>}
        <Button testID="reg-submit" label="Create account" onPress={submit} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RoleChip({ active, label, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.roleChip, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
      <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurface, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, testID, keyboardType, secure }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize={secure || keyboardType === "email-address" ? "none" : "sentences"}
        keyboardType={keyboardType}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface },
  sub: { color: colors.muted, marginTop: 4, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 16, color: colors.onSurface, borderWidth: 1, borderColor: colors.border,
  },
  roleRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  roleChip: {
    flex: 1, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", paddingVertical: 14,
  },
  termsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 16 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  termsText: { color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  error: { color: colors.error, marginBottom: 12 },
});
