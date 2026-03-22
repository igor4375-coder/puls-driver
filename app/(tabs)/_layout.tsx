import { Tabs, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading } = useAuth();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom - 8, 4);
  const tabBarHeight = 50 + bottomPadding;

  const [authSettled, setAuthSettled] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      setAuthSettled(false);
      return;
    }

    if (!authSettled) {
      setAuthSettled(true);
      return;
    }

    // #region agent log
    fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ed9d0'},body:JSON.stringify({sessionId:'6ed9d0',location:'tabs/_layout.tsx:REDIRECT',message:'REDIRECTING to welcome after auth settled',data:{isLoading,isAuthenticated,authSettled},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
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
