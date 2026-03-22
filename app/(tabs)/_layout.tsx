import { Tabs, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useRef, useState } from "react";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading } = useAuth();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom - 8, 4);
  const tabBarHeight = 50 + bottomPadding;

  const wasAuthenticated = useRef(false);
  const [authSettled, setAuthSettled] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      wasAuthenticated.current = true;
      setAuthSettled(false);
      return;
    }

    // Once authenticated in this session, stop auto-redirecting.
    // Explicit sign-out navigates to welcome from the Profile screen.
    if (wasAuthenticated.current) return;

    if (!authSettled) {
      setAuthSettled(true);
      return;
    }

    router.replace("/(auth)/welcome" as any);
  }, [isAuthenticated, isLoading, authSettled]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 4,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Loads",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="truck.box.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="drivers"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="chart.bar.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="bell.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="gear" color={color} />,
        }}
      />
    </Tabs>
  );
}
