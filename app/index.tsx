import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/use-colors";

// #region agent log
import AsyncStorage from "@react-native-async-storage/async-storage";
const DBG_LOG_KEY = '@dbg6bcf75:log';
const _dbg = (loc: string, msg: string, data?: Record<string, unknown>) => {
  const ts = Date.now();
  const entry = `${new Date(ts).toISOString().slice(11, 23)} [${loc}] ${msg} ${data ? JSON.stringify(data) : ''}`;
  console.log(`[DBG-6bcf75] ${entry}`);
  fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6bcf75' },
    body: JSON.stringify({ sessionId: '6bcf75', location: loc, message: msg, data, timestamp: ts }),
  }).catch(() => {});
  AsyncStorage.getItem(DBG_LOG_KEY).then(prev => {
    const lines = prev ? prev.split('\n') : [];
    lines.push(entry);
    if (lines.length > 120) lines.splice(0, lines.length - 120);
    AsyncStorage.setItem(DBG_LOG_KEY, lines.join('\n')).catch(() => {});
  }).catch(() => {});
};
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
