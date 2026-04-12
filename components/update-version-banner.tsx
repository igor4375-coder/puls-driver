import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";

const BUILD_TAG = "v41-localized-lens-name";

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

  // Banner hidden for App Store screenshots
  return null;
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: "center",
    pointerEvents: "none",
  },
  text: {
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
    backgroundColor: "rgba(99,102,241,0.85)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },
});
