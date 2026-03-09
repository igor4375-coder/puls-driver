import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Vibration,
  Animated,
} from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  deliverVINResult,
  getVINLaunchContext,
  matchPendingLoadByLast6,
  type VINDecodeResult,
} from "@/lib/vin-store";

// ─── VIN Helpers ──────────────────────────────────────────────────────────────

/** Full 17-char VIN: no I, O, Q */
function isFullVIN(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim());
}

/** Last-6 serial digits — always numeric or alphanumeric */
function isLast6(input: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{6}$/i.test(input.trim());
}

/** Decode a full 17-char VIN via NHTSA free API */
async function decodeFullVIN(vin: string): Promise<VINDecodeResult> {
  const cleanVIN = vin.trim().toUpperCase();
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${cleanVIN}?format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Network error");
  const json = await response.json();
  const result = json.Results?.[0];
  if (!result) throw new Error("No result");

  return {
    vin: cleanVIN,
    year: result.ModelYear || "",
    make: result.Make
      ? result.Make.charAt(0).toUpperCase() + result.Make.slice(1).toLowerCase()
      : "",
    model: result.Model || "",
    bodyType: result.BodyClass || "",
    engineSize: result.DisplacementL
      ? `${parseFloat(result.DisplacementL).toFixed(1)}L`
      : "",
    trim: result.Trim || "",
    isPartial: false,
  };
}

// ─── Decoded Result Card ──────────────────────────────────────────────────────

function DecodedCard({
  result,
  onConfirm,
  onRetry,
}: {
  result: VINDecodeResult;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const colors = useColors();
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const rows = [
    { label: "VIN", value: result.vin },
    { label: "Year", value: result.year },
    { label: "Make", value: result.make },
    { label: "Model", value: result.model },
    { label: "Body Type", value: result.bodyType },
    { label: "Engine", value: result.engineSize },
    { label: "Trim", value: result.trim },
  ].filter((r) => r.value);

  return (
    <Animated.View
      style={[
        styles.decodedCard,
        { backgroundColor: colors.surface, borderColor: colors.success },
        { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
      ]}
    >
      <View style={[styles.decodedHeader, { backgroundColor: colors.success + "18" }]}>
        <IconSymbol name="checkmark.circle.fill" size={22} color={colors.success} />
        <Text style={[styles.decodedTitle, { color: colors.success }]}>VIN Decoded Successfully</Text>
      </View>

      <View style={styles.decodedRows}>
        {rows.map((row) => (
          <View key={row.label} style={[styles.decodedRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.decodedRowLabel, { color: colors.muted }]}>{row.label}</Text>
            <Text style={[styles.decodedRowValue, { color: colors.foreground }]}>{row.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.decodedActions}>
        <TouchableOpacity
          style={[styles.decodedRetryBtn, { borderColor: colors.border }]}
          onPress={onRetry}
          activeOpacity={0.8}
        >
          <Text style={[styles.decodedRetryText, { color: colors.muted }]}>Scan Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.decodedConfirmBtn, { backgroundColor: colors.success }]}
          onPress={onConfirm}
          activeOpacity={0.85}
        >
          <IconSymbol name="checkmark" size={16} color="#FFFFFF" />
          <Text style={styles.decodedConfirmText}>Use This Vehicle</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function VINScannerScreen() {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [decodedResult, setDecodedResult] = useState<VINDecodeResult | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  // Manual entry state
  const [manualInput, setManualInput] = useState("");
  const [manualMode, setManualMode] = useState<"full" | "last6">("full");
  const [manualDecoding, setManualDecoding] = useState(false);

  const lastScannedRef = useRef<string>("");

  // ── Match toast state ─────────────────────────────────────────────────────
  const [matchToast, setMatchToast] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastScale = useRef(new Animated.Value(0.9)).current;

  const showMatchToast = useCallback((loadNumber: string | undefined, loadId: string) => {
    const label = loadNumber ? `Load #${loadNumber}` : "your load";
    setMatchToast(`Matched to ${label}`);
    Animated.parallel([
      Animated.spring(toastScale, { toValue: 1, useNativeDriver: true, tension: 100, friction: 10 }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      // Hold for 900ms then navigate
      setTimeout(() => {
        router.replace(`/load/${loadId}` as any);
      }, 900);
    });
  }, [toastOpacity, toastScale]);

  // ── No-match toast state ──────────────────────────────────────────────
  const [noMatchToast, setNoMatchToast] = useState(false);
  const noMatchOpacity = useRef(new Animated.Value(0)).current;
  const noMatchScale = useRef(new Animated.Value(0.9)).current;

  const showNoMatchToast = useCallback((prefillParams: Record<string, string>) => {
    setNoMatchToast(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Animated.parallel([
      Animated.spring(noMatchScale, { toValue: 1, useNativeDriver: true, tension: 100, friction: 10 }),
      Animated.timing(noMatchOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        router.replace({ pathname: "/add-load", params: prefillParams } as any);
      }, 900);
    });
  }, [noMatchOpacity, noMatchScale]);

  useEffect(() => {
    if (permission && !permission.granted && !permission.canAskAgain) {
      Alert.alert(
        "Camera Permission Required",
        "Please enable camera access in Settings to scan VIN barcodes.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    }
  }, [permission]);

  // ── Deliver result — route based on launch context ───────────────────────

  const handleConfirmResult = useCallback((result: VINDecodeResult) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const ctx = getVINLaunchContext();
    if (ctx === "add-load") {
      // ── VIN match check: look for a pending/picked-up load whose last-6 VIN matches ──
      const match = matchPendingLoadByLast6(result.vin);
      if (match) {
        // Show toast then navigate to the matched load's detail screen
        showMatchToast(match.loadNumber, match.loadId);
        return;
      }
      // No match — show amber toast then navigate to add-load with vehicle pre-filled
      showNoMatchToast({
        prefillVin: result.vin,
        prefillYear: result.year,
        prefillMake: result.make,
        prefillModel: result.model,
        prefillBodyType: result.bodyType,
        prefillEngineSize: result.engineSize,
        prefillTrim: result.trim,
        prefillIsPartial: result.isPartial ? "1" : "0",
      });
    } else {
      // Return to existing screen (inspection or load detail)
      deliverVINResult(result);
      router.back();
    }
  }, [showMatchToast, showNoMatchToast]);

  // ── Full VIN decode (from scan or manual full-VIN entry) ──────────────────

  const handleFullVINDecode = useCallback(async (vin: string) => {
    setDecoding(true);
    try {
      const result = await decodeFullVIN(vin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDecodedResult(result);
    } catch {
      // If API fails, still use the VIN with empty fields
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setDecodedResult({
        vin,
        year: "",
        make: "",
        model: "",
        bodyType: "",
        engineSize: "",
        trim: "",
        isPartial: false,
      });
    } finally {
      setDecoding(false);
    }
  }, []);

  // ── Barcode scan handler ──────────────────────────────────────────────────

  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (scanned || decoding || decodedResult) return;
      if (data === lastScannedRef.current) return;
      lastScannedRef.current = data;

      // Extract VIN: some barcodes have prefix chars before the 17-char VIN
      const cleaned = data.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
      const vinMatch = cleaned.match(/[A-HJ-NPR-Z0-9]{17}/i);
      const vin = vinMatch ? vinMatch[0] : cleaned;

      if (!isFullVIN(vin)) {
        // Not a valid VIN barcode — ignore silently and keep scanning
        setTimeout(() => { lastScannedRef.current = ""; }, 2000);
        return;
      }

      Vibration.vibrate(80);
      setScanned(true);
      handleFullVINDecode(vin);
    },
    [scanned, decoding, decodedResult, handleFullVINDecode]
  );

  // ── Manual submit ─────────────────────────────────────────────────────────

  const handleManualSubmit = async () => {
    const input = manualInput.trim().toUpperCase();
    if (!input) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (manualMode === "full") {
      if (!isFullVIN(input)) {
        Alert.alert("Invalid VIN", "Please enter a valid 17-character VIN. VINs cannot contain I, O, or Q.");
        return;
      }
      setManualDecoding(true);
      try {
        const result = await decodeFullVIN(input);
        setDecodedResult(result);
        setShowManual(false);
      } catch {
        setDecodedResult({
          vin: input,
          year: "", make: "", model: "", bodyType: "", engineSize: "", trim: "",
          isPartial: false,
        });
        setShowManual(false);
      } finally {
        setManualDecoding(false);
      }
    } else {
      // Last-6 mode — store as partial, no API decode possible
      if (!isLast6(input)) {
        Alert.alert("Invalid Entry", "Please enter exactly 6 alphanumeric characters (the last 6 of the VIN).");
        return;
      }
      const result: VINDecodeResult = {
        vin: input,
        year: "", make: "", model: "", bodyType: "", engineSize: "", trim: "",
        isPartial: true,
      };
      setDecodedResult(result);
      setShowManual(false);
    }
  };

  // ─── Render: Permission loading ──────────────────────────────────────────────

  if (!permission) {
    return (
      <View style={[styles.centered, { backgroundColor: "#000" }]}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <IconSymbol name="camera.fill" size={48} color={colors.muted} />
        <Text style={[styles.permTitle, { color: colors.foreground }]}>Camera Access Needed</Text>
        <Text style={[styles.permSubtitle, { color: colors.muted }]}>
          AutoHaul Driver needs camera access to scan VIN barcodes.
        </Text>
        <TouchableOpacity
          style={[styles.permBtn, { backgroundColor: colors.primary }]}
          onPress={requestPermission}
          activeOpacity={0.85}
        >
          <Text style={styles.permBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelLink} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.cancelLinkText, { color: colors.muted }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Render: Decoded Result ───────────────────────────────────────────────────

  if (decodedResult) {
    return (
      <View style={[styles.resultContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.resultHeader, { backgroundColor: colors.primary }]}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={styles.resultHeaderBack}>
            <IconSymbol name="xmark" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.resultHeaderTitle}>Vehicle Identified</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.resultContent}>
          <DecodedCard
            result={decodedResult}
            onConfirm={() => handleConfirmResult(decodedResult)}
            onRetry={() => {
              setDecodedResult(null);
              setScanned(false);
              lastScannedRef.current = "";
            }}
          />
          {decodedResult.isPartial && (
            <View style={[styles.partialWarning, { backgroundColor: colors.warning + "18", borderColor: colors.warning }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.warning} />
              <Text style={[styles.partialWarningText, { color: colors.warning }]}>
                Last-6 VIN entered. Year, make, and model will need to be filled in manually.
              </Text>
            </View>
          )}
        </View>
        {/* Match toast overlay */}
        {matchToast ? (
          <Animated.View
            style={[
              styles.matchToast,
              { backgroundColor: colors.success, opacity: toastOpacity, transform: [{ scale: toastScale }] },
            ]}
          >
            <IconSymbol name="checkmark.circle.fill" size={22} color="#FFFFFF" />
            <Text style={styles.matchToastText}>{matchToast}</Text>
          </Animated.View>
        ) : null}
        {/* No-match toast overlay */}
        {noMatchToast ? (
          <Animated.View
            style={[
              styles.matchToast,
              { backgroundColor: colors.warning, opacity: noMatchOpacity, transform: [{ scale: noMatchScale }] },
            ]}
          >
            <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#FFFFFF" />
            <Text style={styles.matchToastText}>No matching load — adding as new</Text>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  // ─── Render: Manual Entry ─────────────────────────────────────────────────────

  if (showManual) {
    const isFullMode = manualMode === "full";
    const inputLength = manualInput.length;
    const targetLength = isFullMode ? 17 : 6;
    const isReady = isFullMode ? inputLength === 17 : inputLength === 6;

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.manualContainer, { backgroundColor: colors.background }]}
      >
        {/* Header */}
        <View style={[styles.manualHeader, { backgroundColor: colors.primary }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setShowManual(false)} activeOpacity={0.8}>
            <IconSymbol name="arrow.left" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.manualHeaderTitle}>Enter VIN Manually</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.manualContent}>
          {/* Mode Toggle */}
          <View style={[styles.modeToggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.modeBtn, isFullMode && { backgroundColor: colors.primary }]}
              onPress={() => { setManualMode("full"); setManualInput(""); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeBtnText, { color: isFullMode ? "#FFFFFF" : colors.muted }]}>
                Full VIN (17 digits)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, !isFullMode && { backgroundColor: colors.primary }]}
              onPress={() => { setManualMode("last6"); setManualInput(""); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeBtnText, { color: !isFullMode ? "#FFFFFF" : colors.muted }]}>
                Last 6 Only
              </Text>
            </TouchableOpacity>
          </View>

          {/* Description */}
          <Text style={[styles.modeDescription, { color: colors.muted }]}>
            {isFullMode
              ? "Enter the complete 17-character VIN. We'll automatically decode the year, make, model, and body type."
              : "The last 6 digits of the VIN are unique to each vehicle. You'll need to fill in year, make, and model manually."}
          </Text>

          {/* Input */}
          <Text style={[styles.manualLabel, { color: colors.muted }]}>
            {isFullMode ? "FULL VIN NUMBER" : "LAST 6 DIGITS OF VIN"}
          </Text>
          <TextInput
            style={[
              styles.manualInput,
              {
                backgroundColor: colors.surface,
                color: colors.foreground,
                borderColor: isReady ? colors.success : colors.border,
                letterSpacing: isFullMode ? 2 : 4,
              },
            ]}
            placeholder={isFullMode ? "1HGBH41JXMN109186" : "109186"}
            placeholderTextColor={colors.muted}
            value={manualInput}
            onChangeText={(t) => {
              const clean = t.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, "");
              setManualInput(clean.slice(0, targetLength));
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={targetLength}
            returnKeyType="done"
            onSubmitEditing={handleManualSubmit}
            autoFocus
          />

          <View style={styles.vinCountRow}>
            <Text style={[styles.vinHint, { color: colors.muted }]}>
              {isFullMode ? "No I, O, or Q allowed." : "Letters and numbers only."}
            </Text>
            <Text style={[styles.vinCount, { color: isReady ? colors.success : colors.muted }]}>
              {inputLength}/{targetLength}
            </Text>
          </View>

          {/* Progress dots */}
          <View style={styles.progressDots}>
            {Array.from({ length: targetLength }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i < inputLength ? colors.primary : colors.border,
                    width: isFullMode ? 14 : 20,
                    height: isFullMode ? 14 : 20,
                    borderRadius: isFullMode ? 7 : 10,
                  },
                ]}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.decodeBtn,
              { backgroundColor: colors.primary },
              (!isReady || manualDecoding) && { opacity: 0.45 },
            ]}
            onPress={handleManualSubmit}
            disabled={!isReady || manualDecoding}
            activeOpacity={0.85}
          >
            {manualDecoding ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <IconSymbol name={isFullMode ? "barcode.viewfinder" : "checkmark"} size={18} color="#FFFFFF" />
                <Text style={styles.decodeBtnText}>
                  {isFullMode ? "Decode VIN" : "Use Last-6 VIN"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.scanAgainBtn}
            onPress={() => setShowManual(false)}
            activeOpacity={0.7}
          >
            <IconSymbol name="barcode.viewfinder" size={18} color={colors.primary} />
            <Text style={[styles.scanAgainText, { color: colors.primary }]}>Use Camera Scanner Instead</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Render: Camera Scanner ───────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={flashOn}
        barcodeScannerSettings={{
          barcodeTypes: ["code39", "code128", "pdf417", "qr", "datamatrix", "code93", "aztec"],
        }}
        onBarcodeScanned={scanned || decoding ? undefined : onBarcodeScanned}
      />

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topBarBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <IconSymbol name="xmark" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Scan VIN Barcode</Text>
          <TouchableOpacity
            style={[styles.topBarBtn, flashOn && styles.topBarBtnActive]}
            onPress={() => setFlashOn((f) => !f)}
            activeOpacity={0.8}
          >
            <IconSymbol name="sun.max.fill" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Scan window */}
        <View style={styles.scanArea}>
          <View style={styles.scanWindow}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {(decoding || scanned) && (
              <View style={styles.scanningOverlay}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.scanningText}>Decoding VIN…</Text>
              </View>
            )}
          </View>
          <Text style={styles.scanHint}>
            Align the VIN barcode within the frame{"\n"}(door jamb, dashboard, or windshield)
          </Text>
          <View style={[styles.tipBox, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
            <Text style={styles.tipText}>💡 Tip: The barcode is usually on the driver-side door jamb</Text>
          </View>
        </View>

        {/* Bottom */}
        <View style={styles.bottomBar}>
          {scanned && !decoding ? (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
              onPress={() => { setScanned(false); lastScannedRef.current = ""; }}
              activeOpacity={0.8}
            >
              <Text style={styles.actionBtnText}>Scan Again</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
              onPress={() => setShowManual(true)}
              activeOpacity={0.8}
            >
              <IconSymbol name="pencil" size={16} color="#fff" />
              <Text style={styles.actionBtnText}>Enter VIN Manually</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;
const CORNER_COLOR = "#F97316";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  topBarBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  topBarBtnActive: { backgroundColor: CORNER_COLOR },
  topBarTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  scanArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20 },
  scanWindow: { width: 300, height: 120, position: "relative" },
  corner: { position: "absolute", width: CORNER_SIZE, height: CORNER_SIZE },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS, borderColor: CORNER_COLOR, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS, borderColor: CORNER_COLOR, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS, borderColor: CORNER_COLOR, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS, borderColor: CORNER_COLOR, borderBottomRightRadius: 4 },
  scanningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 4,
  },
  scanningText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  scanHint: { color: "rgba(255,255,255,0.85)", fontSize: 13, textAlign: "center", lineHeight: 20 },
  tipBox: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  tipText: { color: "rgba(255,255,255,0.8)", fontSize: 12, textAlign: "center" },
  bottomBar: {
    paddingHorizontal: 32, paddingBottom: 60, paddingTop: 20,
    backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center",
  },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14,
  },
  actionBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  // Permission screen
  permTitle: { fontSize: 20, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  permSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  permBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  cancelLink: { marginTop: 16, padding: 8 },
  cancelLinkText: { fontSize: 14 },
  // Decoded result screen
  resultContainer: { flex: 1 },
  resultHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, paddingTop: 56,
  },
  resultHeaderBack: { padding: 4 },
  resultHeaderTitle: { fontSize: 18, fontWeight: "700", color: "#FFFFFF" },
  resultContent: { flex: 1, padding: 20, gap: 16 },
  decodedCard: {
    borderRadius: 18, borderWidth: 1.5,
    overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
  },
  decodedHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  decodedTitle: { fontSize: 16, fontWeight: "700" },
  decodedRows: { paddingHorizontal: 16 },
  decodedRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  decodedRowLabel: { fontSize: 13, fontWeight: "500" },
  decodedRowValue: { fontSize: 14, fontWeight: "700", maxWidth: "60%", textAlign: "right" },
  decodedActions: {
    flexDirection: "row", gap: 10, padding: 16,
  },
  decodedRetryBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  decodedRetryText: { fontSize: 14, fontWeight: "600" },
  decodedConfirmBtn: {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  decodedConfirmText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  partialWarning: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  partialWarningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  // Manual entry screen
  manualContainer: { flex: 1 },
  manualHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, paddingTop: 56,
  },
  backBtn: { padding: 4 },
  manualHeaderTitle: { fontSize: 18, fontWeight: "700", color: "#FFFFFF" },
  manualContent: { flex: 1, padding: 20, gap: 16 },
  modeToggle: {
    flexDirection: "row", borderRadius: 12, borderWidth: 1, overflow: "hidden",
  },
  modeBtn: {
    flex: 1, paddingVertical: 12, alignItems: "center", justifyContent: "center",
  },
  modeBtnText: { fontSize: 14, fontWeight: "700" },
  modeDescription: { fontSize: 13, lineHeight: 19 },
  manualLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  manualInput: {
    borderWidth: 1.5, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 16,
    fontSize: 22, fontWeight: "700", textAlign: "center",
  },
  vinCountRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  vinHint: { fontSize: 12 },
  vinCount: { fontSize: 13, fontWeight: "700" },
  progressDots: {
    flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "center",
  },
  dot: { margin: 1 },
  decodeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 16, borderRadius: 14,
  },
  decodeBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  scanAgainBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12,
  },
  scanAgainText: { fontSize: 14, fontWeight: "600" },
  matchToast: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 8,
  },
  matchToastText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
