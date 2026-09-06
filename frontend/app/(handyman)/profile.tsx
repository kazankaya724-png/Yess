import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/material-design-icons";

import { colors } from "@/src/theme";
import { Button, Badge } from "@/src/ui";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { VerifiedBadge } from "@/src/verified-badge";

export default function HandymanProfile() {
  const insets = useSafeAreaInsets();
  const { user, logout, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const stripeStatus = useQuery({ queryKey: ["stripe-status"], queryFn: () => api<any>("/stripe/status") });

  const startVerify = async () => {
    setBusy(true);
    try {
      await api("/verification/start", { method: "POST", body: JSON.stringify({ legal_name: user?.legal_name || user?.email }) });
      await api("/verification/complete", { method: "POST" });
      await refresh();
    } finally { setBusy(false); }
  };

  const startStripe = async () => {
    setBusy(true);
    try {
      const returnUrl = "https://spike-platform.preview.emergentagent.com/(handyman)/profile";
      const r = await api<{ url: string; mocked?: boolean }>("/stripe/onboard", { method: "POST", body: JSON.stringify({ return_url: returnUrl }) });
      if (r.mocked) {
        await refresh();
        stripeStatus.refetch();
      } else if (r.url) {
        await WebBrowser.openBrowserAsync(r.url);
        stripeStatus.refetch();
      }
    } finally { setBusy(false); }
  };

  const identityOk = user?.identity_status === "VERIFIED";
  const isTopRated = (user?.rating_avg ?? 0) >= 4.7;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40 }}>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={{ color: colors.onBrandPrimary, fontSize: 30, fontWeight: "800" }}>
            {(user?.legal_name || user?.email || "?")[0]?.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.legal_name || user?.email}</Text>
        <Text style={styles.role}>Handyman</Text>

        <View style={styles.badgeRow}>
          {identityOk && <VerifiedBadge label="ID VERIFIED" size="sm" tone="brand" testID="badge-id" />}
          {user?.completed_jobs && user.completed_jobs > 20 ? <VerifiedBadge label="TRUSTED PRO" size="sm" tone="silver" /> : null}
          {isTopRated && <VerifiedBadge label="TOP RATED" size="sm" tone="gold" testID="badge-top" />}
        </View>
      </View>

      {!identityOk && (
        <View style={{ marginTop: 16 }}>
          <View style={styles.warnBox}>
            <Icon name="shield-alert-outline" size={18} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.warning, fontWeight: "700" }}>Verification required</Text>
              <Text style={{ color: colors.onSurfaceSecondary, marginTop: 2, fontSize: 13 }}>Complete identity verification to unlock job claiming.</Text>
            </View>
          </View>
          <Button testID="verify-start" label="Verify my identity" onPress={startVerify} loading={busy} />
        </View>
      )}

      <Text style={styles.section}>Performance</Text>
      <View style={styles.grid}>
        <Stat icon="star" label="Rating" value={`${user?.rating_avg ?? "—"}`} />
        <Stat icon="shield-star-outline" label="Reliability" value={String(user?.reliability_score ?? "—")} />
        <Stat icon="hammer-wrench" label="Completed" value={String(user?.completed_jobs ?? 0)} />
      </View>

      <Text style={styles.section}>Payouts</Text>
      <View style={styles.stripeCard}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={stripeStatus.data?.charges_enabled ? "check-circle" : "clock-outline"} size={22} color={stripeStatus.data?.charges_enabled ? colors.success : colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }}>
              {stripeStatus.data?.charges_enabled ? "Payouts active" : "Set up direct payouts"}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              {stripeStatus.data?.mocked
                ? "Sandbox mode — earnings are simulated until you connect a real account."
                : "Powered by Stripe. Money lands directly in your bank."}
            </Text>
          </View>
        </View>
        {!stripeStatus.data?.charges_enabled && (
          <View style={{ marginTop: 12 }}>
            <Button testID="stripe-connect" small label="Connect payouts" onPress={startStripe} loading={busy} />
          </View>
        )}
      </View>

      <View style={{ marginTop: 20 }}>
        <Button testID="signout-btn" label="Sign out" variant="danger" onPress={logout} />
      </View>
    </ScrollView>
  );
}

function Stat({ icon, label, value }: any) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={18} color={colors.brandPrimary} />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 16 },
  hero: { backgroundColor: colors.surfaceSecondary, borderRadius: 20, padding: 20, alignItems: "center" },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  name: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  role: { color: colors.muted, marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 14, justifyContent: "center" },
  warnBox: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FBE8CF", padding: 14, borderRadius: 12, marginBottom: 12 },
  section: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: 24, marginBottom: 10 },
  grid: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, alignItems: "flex-start" },
  stripeCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 14 },
});
