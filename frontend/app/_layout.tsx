import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { LogBox, View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    const inCustomer = segments[0] === "(customer)";
    const inHandyman = segments[0] === "(handyman)";
    const inAdmin = segments[0] === "admin";

    if (!user && !inAuth) {
      router.replace("/(auth)/login");
      return;
    }
    if (user) {
      if (inAuth) {
        if (user.role === "admin") router.replace("/admin");
        else if (user.role === "handyman") router.replace("/(handyman)/available");
        else router.replace("/(customer)/home");
        return;
      }
      // Enforce role isolation
      if (user.role === "customer" && (inHandyman || inAdmin)) router.replace("/(customer)/home");
      if (user.role === "handyman" && (inCustomer || inAdmin)) router.replace("/(handyman)/available");
      if (user.role === "admin" && (inCustomer || inHandyman)) router.replace("/admin");
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.loading} testID="app-loading">
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="dark" />
            <Gate>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
            </Gate>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
