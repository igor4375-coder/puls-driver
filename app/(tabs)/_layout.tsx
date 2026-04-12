import { Tabs, router, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/lib/auth-context";
import { useEffect } from "react";

// #region agent log
const _dbg = (loc: string, msg: string, data?: Record<string, unknown>) => { const p = { sessionId: '887738', location: loc, message: msg, data, timestamp: Date.now() }; console.log(`[DBG-887738] ${loc} | ${msg}`, data ?? ''); fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '887738' }, body: JSON.stringify(p) }).catch(() => {}); };
// #endregion

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const inAuthGroup = segments[0] === "(auth)";
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom - 8, 4);
  const tabBarHeight = 50 + bottomPadding;

  useEffect(() => {
    // #region agent log
    _dbg('tabs/_layout:authGuard', 'effect fired', { isAuthenticated, isLoading, inAuthGroup, segments: segments.join('/') });
    // #endregion
    if (!isLoading && !isAuthenticated && !inAuthGroup) {
      // #region agent log
      _dbg('tabs/_layout:authGuard', 'REDIRECT to welcome — not authenticated', { isAuthenticated, isLoading, inAuthGroup });
      // #endregion
      router.replace("/(auth)/welcome" as any);
    }
  }, [isAuthenticated, isLoading, inAuthGroup]);

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
