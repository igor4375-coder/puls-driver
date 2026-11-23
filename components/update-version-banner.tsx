import React, { useEffect } from "react";
import { Platform } from "react-native";
import * as Updates from "expo-updates";

export const BUILD_TAG = "v148-inline-version-label";

/** Short display form shown in the Loads header (e.g. "v148"). */
export const BUILD_VERSION = BUILD_TAG.split("-")[0] ?? BUILD_TAG;

// The provider tree above this component mounts twice on roughly half of all
// launches, so without a module-level guard the update check ran twice per
// launch and could race itself into a second reload.
let updateCheckStarted = false;

/**
 * Runs the OTA update check in the background. Renders nothing — the short
 * version label lives in the Loads header instead of a floating banner.
 */
export function UpdateVersionBanner() {
  useEffect(() => {
    if (Platform.OS === "web" || !Updates.isEnabled) return;
    if (updateCheckStarted) return;
    updateCheckStarted = true;

    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          // Deliberately NOT reloadAsync(). Drivers reported the app
          // "crashing" a few seconds after opening or pulling to refresh: it
          // was an auto-restart mid-task. expo-updates applies a downloaded
          // update on the next cold start instead.
          await Updates.fetchUpdateAsync();
        }
      } catch {
        // silent — network may be unavailable
      }
    })();
  }, []);

  return null;
}
