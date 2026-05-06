import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";

const BUILD_TAG = "v52-stuck-delivered-fix";

export function UpdateVersionBanner() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web" || !Updates.isEnabled) return;

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

  return (
    <View style={[styles.banner, { top: insets.top + 2 }]} pointerEvents="none">
      <Text style={styles.text}>
        {BUILD_TAG}{checking ? " · checking…" : ""}
      </Text>
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
