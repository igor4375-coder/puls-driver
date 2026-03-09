/**
 * SyncStatusBanner
 *
 * A slim banner that appears at the top of the screen when there are
 * inspection photos pending upload or failed uploads that need attention.
 *
 * - Uploading: blue banner with spinner and count
 * - Failed: red banner with retry button
 * - All done: hides automatically
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { usePhotoQueue } from "@/hooks/use-photo-queue";
import { IconSymbol } from "@/components/ui/icon-symbol";

export function SyncStatusBanner() {
  const colors = useColors();
  const { stats, hasPending, hasFailed, retryFailed } = usePhotoQueue();
  const opacity = useRef(new Animated.Value(0)).current;

  const visible = hasPending || hasFailed;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!visible && !hasFailed) return null;

  const isUploading = stats.uploading > 0;
  const pendingCount = stats.pending + stats.uploading;

  const bgColor = hasFailed && !hasPending ? "#DC2626" : "#2563EB";
  const message = hasFailed && !hasPending
    ? `${stats.failed} photo${stats.failed !== 1 ? "s" : ""} failed to upload`
    : isUploading
    ? `Uploading ${stats.uploading} photo${stats.uploading !== 1 ? "s" : ""}…`
    : `${pendingCount} photo${pendingCount !== 1 ? "s" : ""} queued for upload`;

  return (
    <Animated.View style={[s.banner, { backgroundColor: bgColor, opacity }]}>
      <View style={s.left}>
        {isUploading ? (
          <ActivityIndicator size="small" color="#fff" style={s.icon} />
        ) : (
          <IconSymbol
            name={hasFailed && !hasPending ? "exclamationmark.triangle.fill" : "arrow.right.circle.fill"}
            size={14}
            color="#fff"
          />
        )}
        <Text style={s.text}>{message}</Text>
      </View>

      {hasFailed && (
        <TouchableOpacity onPress={retryFailed} style={s.retryBtn} activeOpacity={0.8}>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    paddingTop: Platform.OS === "ios" ? 8 : 8,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  icon: { marginRight: 2 },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  retryBtn: {
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
