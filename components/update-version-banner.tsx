import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";

export const BUILD_TAG = "v124-notes-show-save";

// The provider tree above this banner mounts twice on roughly half of all
// launches, so without a module-level guard the update check ran twice per
// launch and could race itself into a second reload.
let updateCheckStarted = false;

export function UpdateVersionBanner() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web" || !Updates.isEnabled) return;
    if (updateCheckStarted) return;
    updateCheckStarted = true;

    (async () => {
      try {
        setChecking(true);
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          // Deliberately NOT reloadAsync(). Drivers reported the app
          // "crashing" a few seconds after opening or pulling to refresh: it
          // was this banner restarting the JS context the moment an update
          // landed, mid-task and with no warning. expo-updates applies a
          // downloaded update on the next cold start, so the driver gets it
          // one launch later instead of losing the screen he is looking at.
          if (fetched.isNew) setUpdateReady(true);
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
        {BUILD_TAG}
        {checking ? " · checking…" : updateReady ? " · update ready, reopen app" : ""}
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
