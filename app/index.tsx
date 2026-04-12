import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/use-colors";

// #region agent log
const _dbg = (loc: string, msg: string, data?: Record<string, unknown>) => { const p = { sessionId: '887738', location: loc, message: msg, data, timestamp: Date.now() }; console.log(`[DBG-887738] ${loc} | ${msg}`, data ?? ''); fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '887738' }, body: JSON.stringify(p) }).catch(() => {}); };
// #endregion

export default function Index() {
  const { isSignedIn, isLoaded } = useAuth();
  const colors = useColors();

  useEffect(() => {
    // #region agent log
    _dbg('app/index:redirect', 'effect fired', { isSignedIn, isLoaded });
    // #endregion
    if (!isLoaded) return;
    if (isSignedIn) {
      // #region agent log
      _dbg('app/index:redirect', 'REDIRECT to /(tabs) — signed in', { isSignedIn, isLoaded });
      // #endregion
      router.replace("/(tabs)");
    } else {
      // #region agent log
      _dbg('app/index:redirect', 'REDIRECT to /(auth)/welcome — NOT signed in', { isSignedIn, isLoaded });
      // #endregion
      router.replace("/(auth)/welcome" as any);
    }
  }, [isSignedIn, isLoaded]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
