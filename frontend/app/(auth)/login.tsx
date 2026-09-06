import React, { useState, useEffect } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { colors } from "@/src/theme";
import { Button } from "@/src/ui";
import { useAuth } from "@/src/auth";
import { HoldToVerify } from "@/src/hold-to-verify";

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, loginWithSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const processedSessions = React.useRef<Set<string>>(new Set());
  const extractSid = (url: string | null): string | null => {
    if (!url) return null;
    const m = url.match(/[?#&]session_id=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const processSession = async (sid: string) => {
    if (processedSessions.current.has(sid)) return;
    processedSessions.current.add(sid);
    try {
      setLoading(true);
      await loginWithSession(sid, "customer");
    } catch (e: any) {
      setError(e.message || "Sign-in failed");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (Platform.OS === "web") {
      const url = typeof window !== "undefined" ? window.location.href : "";
      const sid = extractSid(url);
      if (sid) {
        try {
          const { pathname, search } = window.location;
          const cleanSearch = search.replace(/[?&]session_id=[^&]+/, "");
          window.history.replaceState(window.history.state, "", pathname + cleanSearch);
        } catch {}
        processSession(sid);
      }
      return;
    }
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = extractSid(url);
      if (sid) processSession(sid);
    });
    (async () => {
      const initial = await Linking.getInitialURL();
      const sid = extractSid(initial);
      if (sid) processSession(sid);
    })();
    return () => sub.remove();
  }, []);

  const onGoogle = async () => {
    setError(null);
    try {
      const redirectUrl = Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      if (Platform.OS === "web") { window.location.href = authUrl; return; }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let sid = extractSid((result as any).url || null);
      if (!sid) { const initial = await Linking.getInitialURL(); sid = extractSid(initial); }
      if (sid) await processSession(sid);
    } catch (e: any) { setError(e.message || "Google sign-in failed"); }
  };

  const onSubmit = async () => {
    setError(null);
    if (!captchaToken) return setError("Complete the human check first");
    try {
      setLoading(true);
      await login(email.trim(), password, captchaToken);
    } catch (e: any) { setError(e.message || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 40, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={[colors.brandPrimary, colors.brandSecondary]} style={styles.logo}>
          <Text style={styles.logoText}>SPIKE</Text>
        </LinearGradient>
        <Text style={styles.tagline}>Post it. Claim it. Get it done.</Text>

        <Text style={styles.title}>Sign in</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput testID="login-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
            placeholder="you@example.com" placeholderTextColor={colors.muted} style={styles.input} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput testID="login-password" value={password} onChangeText={setPassword} secureTextEntry
            placeholder="********" placeholderTextColor={colors.muted} style={styles.input} />
        </View>

        <View style={{ marginBottom: 14 }}>
          <HoldToVerify
            testID="login-verify"
            verified={!!captchaToken}
            onVerified={(t) => setCaptchaToken(t)}
            onReset={() => setCaptchaToken(null)}
          />
        </View>

        {error && <Text testID="login-error" style={styles.error}>{error}</Text>}

        <Button testID="login-submit" label="Sign in" onPress={onSubmit} loading={loading} disabled={!captchaToken} />
        <View style={{ height: 12 }} />
        <Button testID="login-google" label="Continue with Google" onPress={onGoogle} variant="secondary" />
        <View style={{ height: 24 }} />
        <Pressable testID="go-to-register" onPress={() => router.push("/(auth)/register")}>
          <Text style={styles.linkText}>New to SPIKE? <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>Create an account</Text></Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  logo: { alignSelf: "center", paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16 },
  logoText: { color: colors.onBrand, fontSize: 28, fontWeight: "800", letterSpacing: 2 },
  tagline: { textAlign: "center", color: colors.muted, marginTop: 8, marginBottom: 28, fontSize: 13 },
  title: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginBottom: 20 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 16, color: colors.onSurface, borderWidth: 1, borderColor: colors.border,
  },
  error: { color: colors.error, marginBottom: 12, fontSize: 14 },
  linkText: { textAlign: "center", color: colors.onSurfaceSecondary, fontSize: 14 },
});
