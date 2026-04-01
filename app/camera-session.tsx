/**
 * camera-session.tsx
 *
 * A dedicated top-level route for the multi-shot camera session.
 * Registered in _layout.tsx as presentation: "fullScreenModal" so it sits
 * completely outside any other modal stack — no iOS nesting issues.
 *
 * Flow:
 *   1. Caller does: cameraSessionStore.open(callback, meta); router.push("/camera-session")
 *   2. This screen renders the full-screen camera UI
 *   3. On Done: cameraSessionStore.complete(uris); router.back()
 *   4. On Cancel: cameraSessionStore.cancel(); router.back()
 *
 * Each photo is stamped with GPS coordinates + timestamp before being added
 * to the session, providing tamper-evident chain-of-custody evidence.
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Platform,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { photoQueue, type PhotoQueueEntry, type StampMeta } from "@/lib/photo-queue";
import { cameraSessionStore } from "@/lib/camera-session-store";
import { getCurrentGPS, reverseGeocodeCoords, type GPSCoords } from "@/lib/photo-stamp";
import { useAuth } from "@/lib/auth-context";
import { useLoads } from "@/lib/loads-context";

type SessionMode = "photo" | "video";

const { width: SW } = Dimensions.get("window");
const TOP_INSET = Platform.OS === "ios" ? 56 : 28;
const BOTTOM_INSET = Platform.OS === "ios" ? 44 : 20;
const THUMB_SIZE = 72;

interface CapturedItem {
  uri: string;
  clientId: string | null;
  type: "photo" | "video";
}

export default function CameraSessionScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const { driver } = useAuth();

  const [items, setItems] = useState<CapturedItem[]>([]);
  const [queueEntries, setQueueEntries] = useState<PhotoQueueEntry[]>([]);
  const [mode, setMode] = useState<SessionMode>("photo");
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");
  const [zoom, setZoom] = useState<number>(0);
  const [taking, setTaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<GPSCoords | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { getLoad } = useLoads();
  const meta = cameraSessionStore.getMeta();
  const sessionLoad = meta?.loadId ? getLoad(meta.loadId) : null;
  const sessionVehicle = sessionLoad?.vehicles.find((v) => v.id === meta?.vehicleId);

  // ── Fetch GPS once when screen mounts ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setGpsLoading(true);
    getCurrentGPS().then(async (coords) => {
      if (!cancelled) {
        setGpsCoords(coords);
        setGpsLoading(false);
        // Reverse geocode to get human-readable city name for stamp
        if (coords) {
          reverseGeocodeCoords(coords).then((label) => {
            if (!cancelled) setLocationLabel(label);
          }).catch(() => {});
        }
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsub = photoQueue.subscribe(setQueueEntries);
    return () => {
      unsub();
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleDone = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const resolvedUris = items.map(({ uri, clientId }) => {
      if (clientId) {
        return photoQueue.resolvedUri(clientId) ?? uri;
      }
      return uri;
    });
    const { nextRoute } = cameraSessionStore.getMeta();
    cameraSessionStore.complete(resolvedUris);
    cameraSessionStore.clearMeta();
    if (nextRoute) {
      router.replace(nextRoute as any);
    } else {
      router.back();
    }
  }, [items]);

  const handleCancel = useCallback(() => {
    if (items.length > 0) {
      Alert.alert(
        "Discard Photos?",
        `You've taken ${items.length} photo${items.length !== 1 ? "s" : ""}. Discard them?`,
        [
          { text: "Keep Shooting", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              for (const item of items) {
                if (item.clientId) photoQueue.remove(item.clientId).catch(() => {});
              }
              cameraSessionStore.cancel();
              router.back();
            },
          },
        ]
      );
    } else {
      cameraSessionStore.cancel();
      router.back();
    }
  }, [items.length]);

  const handleTakePhoto = useCallback(async () => {
    if (taking || !cameraRef.current) return;
    setTaking(true);
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 80);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: true,
        exif: true,
        base64: false,
        shutterSound: false,
      });
      setTaking(false);
      if (photo?.uri) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        const inspType = meta?.inspectionType === "delivery" ? "Delivery Condition" : "Pickup Condition";
        const stampMeta: StampMeta = {
          driverCode: driver?.driverCode,
          companyName: sessionLoad?.orgName ?? "Puls Dispatch",
          inspectionType: inspType,
          vin: sessionVehicle?.vin ?? undefined,
          locationLabel,
          lat: gpsCoords?.latitude ?? null,
          lng: gpsCoords?.longitude ?? null,
          capturedAt: new Date().toISOString(),
        };

        // Enqueue immediately — stamp + upload happen in the queue's background pipeline
        const entry = await photoQueue.enqueue(photo.uri, { ...meta, stampMeta });
        setItems((prev) => [
          ...prev,
          { uri: entry.localUri, clientId: entry.clientId, type: "photo" },
        ]);
      }
    } catch {
      setTaking(false);
    }
  }, [taking, meta, gpsCoords, locationLabel, driver, sessionLoad, sessionVehicle]);

  const handleStartRecording = useCallback(async () => {
    if (recording || !cameraRef.current || Platform.OS === "web") return;
    setRecording(true);
    setRecordSeconds(0);
    recordTimerRef.current = setInterval(() => {
      setRecordSeconds((s) => {
        if (s >= 29) {
          cameraRef.current?.stopRecording();
          return 30;
        }
        return s + 1;
      });
    }, 1000);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (video?.uri) {
        const entry = await photoQueue.enqueue(video.uri, meta);
        setItems((prev) => [
          ...prev,
          { uri: entry.localUri, clientId: entry.clientId, type: "video" },
        ]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // ignore
    } finally {
      setRecording(false);
      setRecordSeconds(0);
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
    }
  }, [recording, meta]);

  const handleShutter = useCallback(() => {
    if (mode === "photo") {
      handleTakePhoto();
    } else {
      if (recording) {
        cameraRef.current?.stopRecording();
      } else {
        handleStartRecording();
      }
    }
  }, [mode, recording, handleTakePhoto, handleStartRecording]);

  const handleDeleteItem = useCallback((item: CapturedItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Remove?", "Remove this item?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setItems((prev) => prev.filter((i) => i.uri !== item.uri));
          if (item.clientId) photoQueue.remove(item.clientId).catch(() => {});
        },
      },
    ]);
  }, []);

  const cycleFlash = () =>
    setFlash((f) => (f === "off" ? "on" : f === "on" ? "auto" : "off"));

  const cycleZoom = () => setZoom((z) => (z === 0 ? 0.25 : 0));

  // ── Permission screen ─────────────────────────────────────────────────────

  if (!camPerm) {
    return <View style={s.root} />;
  }

  if (!camPerm.granted) {
    return (
      <View style={[s.root, s.permScreen]}>
        <IconSymbol name="camera.fill" size={56} color="#fff" />
        <Text style={s.permTitle}>Camera Access Required</Text>
        <Text style={s.permSub}>
          Puls Dispatch needs camera access to capture inspection photos and videos.
        </Text>
        <TouchableOpacity
          style={s.permBtn}
          onPress={async () => {
            await requestCamPerm();
            if (mode === "video") await requestMicPerm();
          }}
          activeOpacity={0.8}
        >
          <Text style={s.permBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.permCancel} onPress={handleCancel} activeOpacity={0.7}>
          <Text style={s.permCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Flash icon ────────────────────────────────────────────────────────────

  const flashLabel = flash === "off" ? "Off" : flash === "on" ? "On" : "Auto";
  const zoomLabel = zoom === 0 ? "0.5x" : "1x";

  // ── Main camera UI ────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* Full-screen viewfinder */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flash}
        zoom={zoom}
        mode={mode as any}
        videoQuality="720p"
        videoStabilizationMode="auto"
      />

      {/* Shutter flash overlay */}
      {shutterFlash && (
        <View style={s.shutterFlash} pointerEvents="none" />
      )}

      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <TouchableOpacity style={s.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
          <Text style={s.cancelText}>✕</Text>
        </TouchableOpacity>

        <View style={s.topCenter}>
          {recording ? (
            <View style={s.recBadge}>
              <View style={s.recDot} />
              <Text style={s.recText}>{recordSeconds}s</Text>
            </View>
          ) : (
            // GPS status indicator
            <View style={s.gpsBadge}>
              {gpsLoading ? (
                <>
                  <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.7 }] }} />
                  <Text style={s.gpsText}>Getting GPS…</Text>
                </>
              ) : gpsCoords ? (
                <>
                  <IconSymbol name="location.fill" size={11} color="#4ADE80" />
                  <Text style={[s.gpsText, { color: "#4ADE80" }]}>GPS locked</Text>
                </>
              ) : (
                <>
                  <IconSymbol name="location.slash.fill" size={11} color="#F59E0B" />
                  <Text style={[s.gpsText, { color: "#F59E0B" }]}>Timestamp only</Text>
                </>
              )}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[s.doneBtn, items.length === 0 && s.doneBtnDim]}
          onPress={handleDone}
          activeOpacity={0.8}
        >
          <Text style={s.doneBtnText}>
            Done{items.length > 0 ? ` (${items.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Left column controls ── */}
      <View style={s.leftCol}>
        {/* Photo / Video toggle */}
        <TouchableOpacity
          style={s.leftBtn}
          onPress={() => {
            if (recording) return;
            const next: SessionMode = mode === "photo" ? "video" : "photo";
            setMode(next);
            if (next === "video" && !micPerm?.granted) requestMicPerm();
          }}
          activeOpacity={0.7}
        >
          <View style={[s.leftBtnInner, mode === "video" && s.leftBtnRed]}>
            <IconSymbol
              name={mode === "photo" ? "camera.fill" : "video.fill"}
              size={22}
              color="#fff"
            />
          </View>
        </TouchableOpacity>

        {/* Flash */}
        <TouchableOpacity style={s.leftBtn} onPress={cycleFlash} activeOpacity={0.7}>
          <View style={s.leftBtnInner}>
            <IconSymbol
              name={
                flash === "off"
                  ? "bolt.slash.fill"
                  : flash === "on"
                  ? "bolt.fill"
                  : "bolt.badge.automatic.fill"
              }
              size={20}
              color="#fff"
            />
            <Text style={s.leftBtnLabel}>{flashLabel}</Text>
          </View>
        </TouchableOpacity>

        {/* Zoom */}
        <TouchableOpacity style={s.leftBtn} onPress={cycleZoom} activeOpacity={0.7}>
          <View style={s.leftBtnInner}>
            <Text style={s.zoomText}>{zoomLabel}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Right thumbnail strip ── */}
      <View style={s.thumbCol}>
        <FlatList
          data={[...items].reverse()}
          keyExtractor={(item, idx) => item.uri + idx}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          style={s.thumbList}
          contentContainerStyle={s.thumbListContent}
          showsVerticalScrollIndicator={false}
          inverted
          renderItem={({ item }) => {
            const qEntry = item.clientId
              ? queueEntries.find((e) => e.clientId === item.clientId)
              : null;
            const displayUri = qEntry?.remoteUrl ?? item.uri;
            const isUploading = qEntry?.status === "uploading";
            const isDone = qEntry?.status === "done";
            const isFailed = qEntry?.status === "failed";
            return (
              <TouchableOpacity
                style={s.thumbWrap}
                onPress={() => handleDeleteItem(item)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: displayUri }} style={s.thumbImg} contentFit="cover" />
                {item.type === "video" && (
                  <View style={s.videoBadge}>
                    <IconSymbol name="video.fill" size={10} color="#fff" />
                  </View>
                )}
                {isUploading && (
                  <View style={[s.statusBadge, { backgroundColor: "rgba(0,0,0,0.65)" }]}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                {isDone && (
                  <View style={[s.statusBadge, { backgroundColor: "rgba(34,197,94,0.85)" }]}>
                    <IconSymbol name="checkmark" size={10} color="#fff" />
                  </View>
                )}
                {isFailed && (
                  <View style={[s.statusBadge, { backgroundColor: "rgba(220,38,38,0.85)" }]}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={10} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
        {items.length > 0 && (
          <View style={s.countBadge}>
            <Text style={s.countText}>{items.length}</Text>
          </View>
        )}
      </View>

      {/* ── Bottom shutter ── */}
      <View style={s.bottomBar}>
        {items.length === 0 && (
          <Text style={s.hint}>
            {mode === "photo"
              ? "Tap to capture · Shoot as many as you need"
              : "Tap to start recording · 30 sec max"}
          </Text>
        )}

        <View style={s.shutterRow}>
          <View style={{ width: 60 }} />

          <TouchableOpacity
            style={[
              s.shutter,
              recording && s.shutterRecording,
              taking && s.shutterBusy,
            ]}
            onPress={handleShutter}
            activeOpacity={0.85}
          >
            {mode === "photo" ? (
              <View style={[s.shutterInner, taking && { opacity: 0.5 }]} />
            ) : (
              <View
                style={[
                  s.shutterInner,
                  recording ? s.shutterStopInner : s.shutterVideoInner,
                ]}
              />
            )}
          </TouchableOpacity>

          <View style={{ width: 60 }} />
        </View>

        <Text style={s.modeLabel}>{mode === "photo" ? "PHOTO" : "VIDEO"}</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  // Permission screen
  permScreen: { justifyContent: "center", alignItems: "center", padding: 32 },
  permTitle: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 20 },
  permSub: { color: "#aaa", fontSize: 15, textAlign: "center", marginTop: 10, lineHeight: 22 },
  permBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 28,
  },
  permBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  permCancel: { marginTop: 16, paddingVertical: 10 },
  permCancelText: { color: "#aaa", fontSize: 15 },

  // Shutter flash overlay
  shutterFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    opacity: 0.55,
    zIndex: 20,
  },

  // Top bar
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: TOP_INSET,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 10,
  },
  cancelBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  topCenter: { flex: 1, alignItems: "center" },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(220,38,38,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  recText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  // GPS status badge
  gpsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  gpsText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" },
  doneBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  doneBtnDim: { opacity: 0.45 },
  doneBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Left column
  leftCol: {
    position: "absolute",
    left: 14,
    top: TOP_INSET + 60,
    gap: 14,
    zIndex: 10,
  },
  leftBtn: { alignItems: "center", justifyContent: "center" },
  leftBtnInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  leftBtnRed: { backgroundColor: "rgba(220,38,38,0.75)" },
  leftBtnLabel: { color: "#fff", fontSize: 10, fontWeight: "600" },
  zoomText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Thumbnail strip
  thumbCol: {
    position: "absolute",
    right: 10,
    top: TOP_INSET + 60,
    bottom: BOTTOM_INSET + 130,
    width: THUMB_SIZE + 8,
    zIndex: 10,
    alignItems: "center",
  },
  thumbList: { flex: 1, width: THUMB_SIZE + 8 },
  thumbListContent: { paddingVertical: 4, alignItems: "center" },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    marginBottom: 8,
  },
  thumbImg: { width: "100%", height: "100%" },
  videoBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 8,
    padding: 3,
  },
  statusBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadge: {
    marginTop: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // Bottom shutter
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: BOTTOM_INSET,
    paddingTop: 12,
    alignItems: "center",
    gap: 10,
    zIndex: 10,
  },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center", paddingHorizontal: 20 },
  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: 40,
  },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  shutterRecording: { borderColor: "#EF4444" },
  shutterBusy: { opacity: 0.6 },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fff" },
  shutterVideoInner: { backgroundColor: "#EF4444" },
  shutterStopInner: { width: 28, height: 28, borderRadius: 6, backgroundColor: "#EF4444" },
  modeLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});
