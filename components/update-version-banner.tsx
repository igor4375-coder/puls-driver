import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform, TouchableOpacity, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BUILD_TAG = "v50-keychain-bg-fix";
const DBG_LOG_KEY = '@dbg6bcf75:log';

export function UpdateVersionBanner() {
  const insets = useSafeAreaInsets();
  const [updateId, setUpdateId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web" || !Updates.isEnabled) return;
    setUpdateId(Updates.updateId ?? null);

    (async () => {
      try {
        setChecking(true);
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          if (fetched.isNew) {
            await Updates.reloadAsync();
          }
        }
      } catch {
        // silent — network may be unavailable
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  if (Platform.OS === "web") return null;

  const showDebugLog = async () => {
    try {
      const logs = (await AsyncStorage.getItem(DBG_LOG_KEY)) ?? '(no logs yet)';
      const wasAuth = await AsyncStorage.getItem('@autohaul:was_authenticated');
      const allLines = logs.split('\n');
      const last30 = allLines.slice(-30).join('\n');
      const fullDump = `BUILD_TAG=${BUILD_TAG} wasAuth=${wasAuth}\n\n${logs}`;
      Alert.alert(
        `Debug: Auth Log (6bcf75) [${BUILD_TAG}]`,
        `wasAuth=${wasAuth}\n\n--- LAST 30 OF ${allLines.length} LINES ---\n${last30}\n\nTap "Copy ALL" to copy the full ${allLines.length}-line log to clipboard, then paste in chat.`,
        [
          {
            text: 'Copy ALL',
            onPress: async () => {
              try {
                await Clipboard.setStringAsync(fullDump);
                Alert.alert('Copied', `${allLines.length} log lines copied to clipboard. Paste them in WhatsApp/chat now.`);
              } catch (e: any) {
                Alert.alert('Copy failed', String(e?.message ?? e));
              }
            },
          },
          { text: 'Clear Logs', style: 'destructive', onPress: () => { AsyncStorage.removeItem(DBG_LOG_KEY).catch(() => {}); } },
          { text: 'OK', style: 'cancel' },
        ]
      );
    } catch (e: any) {
      Alert.alert('Debug log error', String(e?.message ?? e));
    }
  };

  return (
    <View style={[styles.banner, { top: insets.top + 2 }]}>
      <TouchableOpacity onPress={showDebugLog} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
        <Text style={styles.text}>
          {BUILD_TAG}{checking ? " · checking…" : ""} · tap for log
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: "center",
  },
  text: {
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
    backgroundColor: "rgba(99,102,241,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
});
