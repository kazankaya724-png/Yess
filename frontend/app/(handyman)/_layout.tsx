import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";
import { colors } from "@/src/theme";

const tabIcon = (name: string) => {
  const Comp = ({ color, size }: { color: string; size: number }) => <Icon name={name as any} size={size} color={color} />;
  Comp.displayName = `TabIcon-${name}`;
  return Comp;
};

export default function HandymanLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2, marginTop: -2 },
        tabBarItemStyle: { paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="available" options={{ title: "Find Jobs", tabBarIcon: tabIcon("radar") }} />
      <Tabs.Screen name="my-jobs" options={{ title: "My Jobs", tabBarIcon: tabIcon("hammer-wrench") }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarIcon: tabIcon("chat-outline") }} />
      <Tabs.Screen name="earnings" options={{ title: "Earnings", tabBarIcon: tabIcon("cash-multiple") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: tabIcon("account-circle-outline") }} />
    </Tabs>
  );
}
