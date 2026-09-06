import { Redirect } from "expo-router";
import { useAuth } from "@/src/auth";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  if (user.role === "handyman") return <Redirect href="/(handyman)/available" />;
  return <Redirect href="/(customer)/home" />;
}
