/**
 * SyncStatusBanner
 *
 * A slim banner that appears at the top of the screen when there are
 * inspection photos pending upload or failed uploads that need attention.
 *
 * - Uploading: blue banner with spinner and count
 * - Failed: red banner with retry button
 * - All done: hides automatically
 * - Tappable: opens a detail modal with per-photo status
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Platform,
  Modal,
  FlatList,
  SafeAreaView,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { usePhotoQueue } from "@/hooks/use-photo-queue";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { PhotoQueueEntry } from "@/lib/photo-queue";

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function statusIcon(status: string): { name: string; color: string } {
  switch (status) {
    case "done":
      return { name: "checkmark.circle.fill", color: "#22C55E" };
    case "uploading":
      return { name: "arrow.up.circle.fill", color: "#3B82F6" };
    case "failed":
      return { name: "xmark.circle.fill", color: "#EF4444" };
    default:
      return { name: "clock.fill", color: "#94A3B8" };
  }
}

function EntryRow({ entry, now }: { entry: PhotoQueueEntry; now: number }) {
  const elapsed = now - entry.createdAt;
  const icon = statusIcon(entry.status);
  const vin = entry.stampMeta?.vin;
  const label = vin ? `VIN …${vin.slice(-6)}` : entry.clientId.slice(0, 8);

  return (
    <View style={d.row}>
      <IconSymbol name={icon.name as any} size={18} color={icon.color} />
      <View style={d.rowInfo}>
        <Text style={d.rowLabel} numberOfLines={1}>{label}</Text>
        <Text style={d.rowMeta}>
          {entry.status === "uploading" ? "Uploading" : entry.status === "pending" ? "Queued" : entry.status === "done" ? "Done" : "Failed"}
          {" · "}{formatElapsed(elapsed)}
          {entry.attempts > 0 ? ` · Attempt ${entry.attempts}` : ""}
        </Text>
        {entry.lastError ? (
          <Text style={d.rowError} numberOfLines={2}>{entry.lastError}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function SyncStatusBanner() {
  const colors = useColors();
  const { entries, stats, hasPending, hasFailed, retryFailed, sync } = usePhotoQueue();
  const opacity = useRef(new Animated.Value(0)).current;
  const [detailVisible, setDetailVisible] = useState(false);
  const [now, setNow] = useState(Date.now());

  const visible = hasPending || hasFailed;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => {
    if (!detailVisible) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [detailVisible]);

  const activeEntries = entries.filter(
    (e) => e.status !== "done"
  );

  const recentDone = entries
    .filter((e) => e.status === "done")
    .sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))
    .slice(0, 10);

  const detailEntries = [...activeEntries, ...recentDone];

  const handleRetryAll = useCallback(() => {
    retryFailed();
  }, [retryFailed]);

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
    <>
      <Animated.View style={[s.banner, { backgroundColor: bgColor, opacity }]}>
        <TouchableOpacity
          style={s.left}
          onPress={() => { setNow(Date.now()); setDetailVisible(true); }}
          activeOpacity={0.7}
        >
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
          <IconSymbol name="chevron.right" size={12} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>

        {hasFailed && (
          <TouchableOpacity onPress={retryFailed} style={s.retryBtn} activeOpacity={0.8}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      <Modal
        visible={detailVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailVisible(false)}
      >
        <SafeAreaView style={[d.container, { backgroundColor: colors.background }]}>
          <View style={d.header}>
            <Text style={[d.title, { color: colors.text }]}>Upload Queue</Text>
            <TouchableOpacity onPress={() => setDetailVisible(false)} hitSlop={12}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={d.statsRow}>
            <StatPill label="Queued" count={stats.pending} color="#94A3B8" />
            <StatPill label="Uploading" count={stats.uploading} color="#3B82F6" />
            <StatPill label="Done" count={stats.done} color="#22C55E" />
            <StatPill label="Failed" count={stats.failed} color="#EF4444" />
          </View>

          {hasFailed && (
            <TouchableOpacity style={d.retryAllBtn} onPress={handleRetryAll} activeOpacity={0.8}>
              <IconSymbol name="arrow.clockwise" size={16} color="#fff" />
              <Text style={d.retryAllText}>Retry All Failed</Text>
            </TouchableOpacity>
          )}

          <FlatList
            data={detailEntries}
            keyExtractor={(item) => item.clientId}
            renderItem={({ item }) => <EntryRow entry={item} now={now} />}
            contentContainerStyle={d.list}
            ListEmptyComponent={
              <Text style={[d.empty, { color: colors.textSecondary }]}>
                No photos in queue
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

function StatPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={[d.pill, { backgroundColor: color + "18" }]}>
      <View style={[d.dot, { backgroundColor: color }]} />
      <Text style={[d.pillText, { color }]}>{count}</Text>
      <Text style={[d.pillLabel, { color: color + "CC" }]}>{label}</Text>
    </View>
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

const d = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "700",
  },
  pillLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  retryAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#EF4444",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    marginBottom: 8,
  },
  retryAllText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
    gap: 10,
  },
  rowInfo: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1E293B",
  },
  rowMeta: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  rowError: {
    fontSize: 11,
    color: "#EF4444",
    marginTop: 3,
  },
  empty: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
  },
});
