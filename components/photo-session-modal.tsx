/**
 * PhotoSessionModal — SuperDispatch-style camera session.
 *
 * Layout (portrait):
 *   ┌─────────────────────────────────────────────┐
 *   │  [Done]                          photo count │  ← top bar
 *   │                                             │
 *   │         FULL-SCREEN LIVE VIEWFINDER         │
 *   │                                             │
 *   │  [📷/🎬]   [⚡]   [0.5x]                   │  ← left column controls
 *   │                                             │
 *   │                         [thumb 1]           │
 *   │                         [thumb 2]           │  ← right thumbnail strip
 *   │                         [thumb 3]           │
 *   │                         [  ...  ]           │
 *   │                                             │
 *   │              ●  ←── shutter button          │  ← bottom center
 *   └─────────────────────────────────────────────┘
 *
 * Features:
 *  - Camera stays open the entire session (200+ photos)
 *  - Photo mode: tap shutter to capture
 *  - Video mode: hold/tap shutter to record up to 30 s, tap again to stop
 *  - Flash toggle (off / on / auto)
 *  - Zoom toggle (1x / 2x)
 *  - Vertical thumbnail strip on the right — tap thumbnail to delete
 *  - "Done" button top-right to finish session
 *  - Upload status badges on thumbnails (pending / uploading / done / failed)
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
  Modal,
  Image,
  FlatList,
  Alert,
  Platform,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { photoQueue, PhotoQueueEntry } from "@/lib/photo-queue";

type SessionMode = "photo" | "video";

const { width: SW, height: SH } = Dimensions.get("window");

// ─── Props ────────────────────────────────────────────────────────────────────

interface CapturedItem {
  uri: string;
  clientId: string | null;
  type: "photo" | "video";
}

interface Props {
  visible: boolean;
  initialPhotos?: string[];
  meta?: { loadId?: string; vehicleId?: string };
  onDone: (photos: string[]) => void;
  onCancel: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PhotoSessionModal({ visible, initialPhotos = [], meta, onDone, onCancel }: Props) {
  const colors = useColors();
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  // ── State ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<CapturedItem[]>(
    initialPhotos.map((uri) => ({ uri, clientId: null, type: "photo" as const }))
  );
  const [queueEntries, setQueueEntries] = useState<PhotoQueueEntry[]>([]);
  const [mode, setMode] = useState<SessionMode>("photo");
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");
  const [zoom, setZoom] = useState<0 | 0.5>(0); // 0 = 1x, 0.5 = 2x approx
  const [taking, setTaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [shutterFlash, setShutterFlash] = useState(false);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    setItems(initialPhotos.map((uri) => ({ uri, clientId: null, type: "photo" as const })));
    setMode("photo");
    setFlash("off");
    setZoom(0);
    setTaking(false);
    setRecording(false);
    setRecordSeconds(0);

    const unsub = photoQueue.subscribe(setQueueEntries);
    return () => {
      unsub();
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, [visible]);

  // ── Permissions ────────────────────────────────────────────────────────────
  const permissionsGranted =
    camPerm?.granted && (mode === "photo" || micPerm?.granted);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleTakePhoto = useCallback(async () => {
    if (taking || !cameraRef.current) return;
    setTaking(true);
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 80);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,           // No compression — preserve full camera sensor quality
        skipProcessing: true, // faster capture; orientation handled by viewer
        exif: true,           // Keep EXIF so GPS/timestamp metadata is retained
        base64: false,
        shutterSound: false,
      });
      if (photo?.uri) {
        const entry = await photoQueue.enqueue(photo.uri, meta);
        setItems((prev) => [
          ...prev,
          { uri: entry.localUri, clientId: entry.clientId, type: "photo" },
        ]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      // Silently ignore — camera stays open
    } finally {
      setTaking(false);
    }
  }, [taking, meta]);

  const handleStartRecording = useCallback(async () => {
    if (recording || !cameraRef.current || Platform.OS === "web") return;
    setRecording(true);
    setRecordSeconds(0);
    recordTimerRef.current = setInterval(() => {
      setRecordSeconds((s) => {
        if (s >= 29) {
          handleStopRecording();
          return 30;
        }
        return s + 1;
      });
    }, 1000);

    try {
      const video = await cameraRef.current.recordAsync({
        maxDuration: 30,
      });
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

  const handleStopRecording = useCallback(() => {
    cameraRef.current?.stopRecording();
  }, []);

  const handleShutter = useCallback(() => {
    if (mode === "photo") {
      handleTakePhoto();
    } else {
      if (recording) {
        handleStopRecording();
      } else {
        handleStartRecording();
      }
    }
  }, [mode, recording, handleTakePhoto, handleStartRecording, handleStopRecording]);

  const handleDeleteItem = useCallback((item: CapturedItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Remove?", "Remove this item from the session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setItems((prev) => prev.filter((i) => i.uri !== item.uri));
          if (item.clientId) photoQueue.remove(item.clientId).catch((err) => console.warn("[PhotoSession]", err));
        },
      },
    ]);
  }, []);

  const handleDone = useCallback(() => {
    if (items.length === 0) {
      Alert.alert("No Media", "Capture at least one photo or video before finishing.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const resolvedUris = items.map(({ uri, clientId }) => {
      if (clientId) return photoQueue.resolvedUri(clientId) ?? uri;
      return uri;
    });
    onDone(resolvedUris);
  }, [items, onDone]);

  const cycleFlash = () => {
    setFlash((f) => (f === "off" ? "on" : f === "on" ? "auto" : "off"));
  };

  const cycleZoom = () => {
    setZoom((z) => (z === 0 ? 0.5 : 0));
  };

  // ── Permission screens ─────────────────────────────────────────────────────

  const renderPermissionScreen = () => (
    <View style={[s.root, { backgroundColor: "#000", justifyContent: "center", alignItems: "center", padding: 32 }]}>
      <IconSymbol name="camera.fill" size={56} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 20 }}>
        Camera Access Required
      </Text>
      <Text style={{ color: "#aaa", fontSize: 15, textAlign: "center", marginTop: 10, lineHeight: 22 }}>
        Puls Dispatch needs camera access to capture inspection photos and videos.
      </Text>
      <TouchableOpacity
        style={{ backgroundColor: colors.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14, marginTop: 28 }}
        onPress={async () => {
          await requestCamPerm();
          if (mode === "video") await requestMicPerm();
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Grant Camera Access</Text>
      </TouchableOpacity>
      <TouchableOpacity style={{ marginTop: 16, paddingVertical: 10 }} onPress={onCancel}>
        <Text style={{ color: "#aaa", fontSize: 15 }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Main camera UI ─────────────────────────────────────────────────────────

  const flashIcon = flash === "off" ? "bolt.slash.fill" : flash === "on" ? "bolt.fill" : "bolt.badge.automatic.fill";
  const flashLabel = flash === "off" ? "Off" : flash === "on" ? "On" : "Auto";
  const zoomLabel = zoom === 0 ? "1x" : "2x";

  const renderCameraUI = () => (
    <View style={s.root}>
      {/* ── Full-screen camera viewfinder ── */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flash}
        zoom={zoom}
        mode={mode as any}
        videoQuality="720p" // eslint-disable-line @typescript-eslint/no-explicit-any
        videoStabilizationMode="auto"
      />

      {/* Shutter flash overlay */}
      {shutterFlash && <View style={s.shutterFlash} pointerEvents="none" />}

      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
          <Text style={s.cancelText}>✕</Text>
        </TouchableOpacity>

        <View style={s.topCenter}>
          {recording && (
            <View style={s.recBadge}>
              <View style={s.recDot} />
              <Text style={s.recText}>{recordSeconds}s</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[s.doneBtn, items.length === 0 && s.doneBtnDisabled]}
          onPress={handleDone}
          activeOpacity={0.8}
        >
          <Text style={s.doneBtnText}>Done{items.length > 0 ? ` (${items.length})` : ""}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Left column controls ── */}
      <View style={s.leftCol}>
        {/* Mode toggle: photo / video */}
        <TouchableOpacity
          style={s.leftBtn}
          onPress={() => {
            if (recording) return;
            const next = mode === "photo" ? "video" : "photo";
            setMode(next);
            if (next === "video" && !micPerm?.granted) requestMicPerm();
          }}
          activeOpacity={0.7}
        >
          <View style={[s.leftBtnInner, mode === "video" && s.leftBtnActive]}>
            <IconSymbol
              name={mode === "photo" ? "camera.fill" : "video.fill"}
              size={22}
              color="#fff"
            />
          </View>
        </TouchableOpacity>

        {/* Flash toggle */}
        <TouchableOpacity style={s.leftBtn} onPress={cycleFlash} activeOpacity={0.7}>
          <View style={s.leftBtnInner}>
            <IconSymbol name={flashIcon as any} size={20} color="#fff" />
            <Text style={s.leftBtnLabel}>{flashLabel}</Text>
          </View>
        </TouchableOpacity>

        {/* Zoom toggle */}
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
          style={s.thumbScroll}
          contentContainerStyle={s.thumbScrollContent}
          showsVerticalScrollIndicator={false}
          inverted
          renderItem={({ item }) => {
            const qEntry = item.clientId
              ? queueEntries.find((e) => e.clientId === item.clientId)
              : null;
            const displayUri = qEntry?.remoteUrl ?? item.uri;
            const isUploading = qEntry?.status === "uploading";
            const isFailed = qEntry?.status === "failed";
            const isDone = qEntry?.status === "done";
            const isVideo = item.type === "video";
            return (
              <TouchableOpacity
                style={[s.thumbWrap, { marginBottom: 8 }]}
                onPress={() => handleDeleteItem(item)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: displayUri }} style={s.thumb} resizeMode="cover" />
                {isVideo && (
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
        {/* Count badge */}
        {items.length > 0 && (
          <View style={s.countBadge}>
            <Text style={s.countText}>{items.length}</Text>
          </View>
        )}
      </View>

      {/* ── Bottom shutter area ── */}
      <View style={s.bottomBar}>
        {/* Hint text */}
        {items.length === 0 && (
          <Text style={s.hint}>
            {mode === "photo" ? "Tap to capture photos" : "Tap to start / stop recording (30s max)"}
          </Text>
        )}

        <View style={s.shutterRow}>
          {/* Spacer left */}
          <View style={{ width: 60 }} />

          {/* Shutter button */}
          <TouchableOpacity
            style={[s.shutter, recording && s.shutterRecording, taking && s.shutterBusy]}
            onPress={handleShutter}
            activeOpacity={0.85}
          >
            {mode === "photo" ? (
              <View style={[s.shutterInner, taking && { opacity: 0.5 }]} />
            ) : (
              <View style={[s.shutterInner, recording ? s.shutterStopInner : s.shutterVideoInner]} />
            )}
          </TouchableOpacity>

          {/* Spacer right — reserved for future flip button */}
          <View style={{ width: 60 }} />
        </View>

        {/* Mode label */}
        <Text style={s.modeLabel}>{mode === "photo" ? "PHOTO" : "VIDEO"}</Text>
      </View>
    </View>
  );

  // ── Modal root ─────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {!camPerm?.granted ? renderPermissionScreen() : renderCameraUI()}
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TOP_INSET = Platform.OS === "ios" ? 56 : 28;
const BOTTOM_INSET = Platform.OS === "ios" ? 44 : 20;
const THUMB_W = 72;
const THUMB_H = 72;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },

  // ── Shutter flash overlay ──
  shutterFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    opacity: 0.55,
    zIndex: 20,
  },

  // ── Top bar ──
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
  cancelText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  topCenter: {
    flex: 1,
    alignItems: "center",
  },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(220,38,38,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  recText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  doneBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  doneBtnDisabled: {
    opacity: 0.45,
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  // ── Left column ──
  leftCol: {
    position: "absolute",
    left: 14,
    top: TOP_INSET + 60,
    gap: 14,
    zIndex: 10,
  },
  leftBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  leftBtnInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  leftBtnActive: {
    backgroundColor: "rgba(220,38,38,0.75)",
  },
  leftBtnLabel: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  zoomText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  // ── Right thumbnail strip ──
  thumbCol: {
    position: "absolute",
    right: 10,
    top: TOP_INSET + 60,
    bottom: BOTTOM_INSET + 130,
    width: THUMB_W + 8,
    zIndex: 10,
    alignItems: "center",
  },
  thumbScroll: {
    flex: 1,
    width: THUMB_W + 8,
  },
  thumbScrollContent: {
    gap: 8,
    paddingVertical: 4,
    alignItems: "center",
  },
  thumbWrap: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
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
  countText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },

  // ── Bottom shutter area ──
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
  hint: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    textAlign: "center",
  },
  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
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
  shutterRecording: {
    borderColor: "#EF4444",
  },
  shutterBusy: {
    opacity: 0.6,
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
  },
  shutterVideoInner: {
    backgroundColor: "#EF4444",
  },
  shutterStopInner: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#EF4444",
  },
  modeLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});
