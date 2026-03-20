/**
 * Pickup Signature Screen
 *
 * Shown when the driver taps "Mark as Picked Up" (after photos are confirmed).
 * Three paths:
 *   1. Customer is present → draw customer signature → draw driver signature → confirm immediately
 *   2. Customer not available:
 *        - First time (no saved sig): show driver_sig screen, auto-save sig on confirm
 *        - Subsequent times (saved sig exists): auto-confirm instantly — no screen shown
 *   3. Skip signature → confirm with warning
 *
 * On confirmation the screen updates local load status to "picked_up" and
 * fires the platform sync mutation, then navigates back to the loads list.
 */

import { useRef, useState, useCallback } from "react";
import { photoQueue } from "@/lib/photo-queue";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
  Alert,
  ScrollView,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useLoads } from "@/lib/loads-context";
import { useAuth } from "@/lib/auth-context";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSettings } from "@/lib/settings-context";
import { pickupHighlightStore } from "@/lib/pickup-highlight-store";

// ─── Types ────────────────────────────────────────────────────────────────────

type SignatureMode =
  | "choose"        // initial: choose customer present / not available / skip
  | "customer_sig"  // drawing customer signature
  | "driver_sig";   // drawing driver signature → confirm immediately

interface StrokePath { d: string }

// ─── Signature Pad ────────────────────────────────────────────────────────────

function SignaturePad({
  label,
  paths,
  onPathsChange,
  onClear,
  accentColor,
  onDrawStart,
  onDrawEnd,
}: {
  label: string;
  paths: StrokePath[];
  onPathsChange: (paths: StrokePath[]) => void;
  onClear?: () => void;
  accentColor: string;
  onDrawStart?: () => void;
  onDrawEnd?: () => void;
}) {
  const colors = useColors();
  const currentPath = useRef<string>("");
  const isDrawing = useRef(false);
  const pathsRef = useRef<StrokePath[]>(paths);
  pathsRef.current = paths;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        isDrawing.current = true;
        onDrawStart?.();
      },
      onPanResponderMove: (evt) => {
        if (!isDrawing.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        const stable = pathsRef.current.filter((p) => !p.d.startsWith("__live__"));
        onPathsChange([...stable, { d: "__live__" + currentPath.current }]);
      },
      onPanResponderRelease: () => {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        const finalD = currentPath.current;
        currentPath.current = "";
        const stable = pathsRef.current.filter((p) => !p.d.startsWith("__live__"));
        onPathsChange([...stable, { d: finalD }]);
        onDrawEnd?.();
      },
      onPanResponderTerminate: () => {
        isDrawing.current = false;
        onDrawEnd?.();
      },
    })
  ).current;

  const hasStrokes = paths.some((p) => !p.d.startsWith("__live__"));

  return (
    <View style={[sigStyles.container, { borderColor: colors.border }]}>
      <View style={sigStyles.labelRow}>
        <Text style={[sigStyles.label, { color: colors.muted }]}>{label}</Text>
        {hasStrokes && (
          <TouchableOpacity
            onPress={() => { onPathsChange([]); onClear?.(); }}
            activeOpacity={0.7}
            style={sigStyles.clearBtn}
          >
            <IconSymbol name="eraser.fill" size={14} color={colors.muted} />
            <Text style={[sigStyles.clearText, { color: colors.muted }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <View
        style={[sigStyles.canvas, { borderColor: colors.border, backgroundColor: colors.surface }]}
        {...panResponder.panHandlers}
      >
        <Svg style={StyleSheet.absoluteFill}>
          {paths.map((p, i) => (
            <Path
              key={i}
              d={p.d.startsWith("__live__") ? p.d.slice(8) : p.d}
              stroke={accentColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
        {!hasStrokes && paths.length === 0 && (
          <Text style={[sigStyles.placeholder, { color: colors.border }]}>Sign here</Text>
        )}
      </View>
    </View>
  );
}

const sigStyles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  clearText: {
    fontSize: 12,
    fontWeight: "500",
  },
  canvas: {
    height: 200,
    borderTopWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    fontSize: 16,
    fontStyle: "italic",
  },
});

// ─── Option Button ─────────────────────────────────────────────────────────────

function OptionButton({
  icon,
  title,
  subtitle,
  onPress,
  color,
}: {
  icon: any;
  title: string;
  subtitle: string;
  onPress: () => void;
  color: string;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[optStyles.btn, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[optStyles.iconWrap, { backgroundColor: color + "18" }]}>
        <IconSymbol name={icon} size={24} color={color} />
      </View>
      <View style={optStyles.textWrap}>
        <Text style={[optStyles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[optStyles.subtitle, { color: colors.muted }]}>{subtitle}</Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color={colors.muted} />
    </TouchableOpacity>
  );
}

const optStyles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: { flex: 1 },
  title: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function PickupSignatureScreen() {
  const colors = useColors();
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const { loads, updateLoadStatus } = useLoads();
  const { driver } = useAuth();
  const markAsPickedUpAction = useAction(api.platform.markAsPickedUp);
  const saveSignatureMutation = useMutation(api.signatures.save);
  const { settings, setDriverSignaturePaths } = useSettings();

  // A saved driver signature exists if there are any stable (non-live) paths
  const savedDriverPaths = settings.driverSignaturePaths.filter((p) => !p.d.startsWith("__live__"));
  const hasSavedDriverSig = savedDriverPaths.length > 0;

  const load = loads.find((l) => l.id === loadId);

  const [mode, setMode] = useState<SignatureMode>("choose");
  const [customerNotAvailable, setCustomerNotAvailable] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPaths, setCustomerPaths] = useState<StrokePath[]>([]);
  const [driverPaths, setDriverPaths] = useState<StrokePath[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  // Disable scroll while drawing so touches go to the signature pad
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const hasCustomerSig = customerPaths.some((p) => !p.d.startsWith("__live__"));
  const hasDriverSig = driverPaths.some((p) => !p.d.startsWith("__live__"));

  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? "";

  const doConfirmPickup = useCallback((overrideDriverSig?: string, overrideCustomerNotAvailable?: boolean) => {
    if (!load || isConfirming) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsConfirming(true);

    const isNotAvailable = overrideCustomerNotAvailable ?? customerNotAvailable;

    // Update local state immediately
    updateLoadStatus(load.id, "picked_up");
    pickupHighlightStore.signal("picked_up", "Vehicle picked up — moved to Picked Up tab");

    // Navigate back to loads list
    router.back();
    router.back();

    // Fire-and-forget signature save
    const serializePaths = (paths: StrokePath[]) =>
      paths.filter((p) => !p.d.startsWith("__live__")).map((p) => p.d).join(" ");

    const driverSigStr = overrideDriverSig ?? (hasDriverSig ? serializePaths(driverPaths) : undefined);

    if (driverCode) {
      saveSignatureMutation({
        loadId: load.loadNumber ?? load.id,
        driverCode,
        signatureType: "pickup",
        customerName: customerName.trim() || undefined,
        customerSig: hasCustomerSig ? serializePaths(customerPaths) : undefined,
        driverSig: driverSigStr,
        customerNotAvailable: isNotAvailable,
        capturedAt: new Date().toISOString(),
      }).catch((err) => console.warn("[PickupSignature] Signature save failed:", err));
    }

    // Fire-and-forget platform sync
    const isPlatformLoad = load.id.startsWith("platform-");
    const platformTripId = isPlatformLoad
      ? (load.platformTripId ?? load.id.replace("platform-", ""))
      : null;

    if (isPlatformLoad && platformTripId && driverCode) {
      (async () => {
        try {
          const urls: string[] = [];
          for (const v of load.vehicles) {
            const vUrls = await photoQueue.flushAndGetUrls(load.id, v.id);
            urls.push(...vUrls);
          }
          const existingHttp = load.vehicles.flatMap(
            (v) => (v.pickupInspection?.photos ?? []).filter((p) => p.startsWith("http"))
          );
          const pickupPhotos = [...new Set([...existingHttp, ...urls])];
          await markAsPickedUpAction({
            loadNumber: load.loadNumber,
            legId: platformTripId,
            driverCode,
            pickupTime: new Date().toISOString(),
            pickupGPS: { lat: 0, lng: 0 },
            pickupPhotos,
          });
        } catch (err) {
          console.warn("[PickupSignature] Platform sync failed:", err);
        }
      })();
    }
  }, [load, isConfirming, customerNotAvailable, hasCustomerSig, hasDriverSig, customerPaths, driverPaths, driverCode, updateLoadStatus, saveSignatureMutation, markAsPickedUpAction]);

  /**
   * Called when driver confirms their signature on the driver_sig step.
   * If this is the first time (no saved signature), auto-saves it to Settings
   * so all future "Customer Not Available" taps will skip this screen entirely.
   */
  const handleDriverSigConfirm = useCallback(() => {
    if (!hasDriverSig || isConfirming) return;

    // Auto-save driver signature to Settings on first use
    if (!hasSavedDriverSig) {
      const stablePaths = driverPaths.filter((p) => !p.d.startsWith("__live__"));
      setDriverSignaturePaths(stablePaths);
      // No blocking alert — just save silently and confirm
    }

    doConfirmPickup();
  }, [hasDriverSig, isConfirming, hasSavedDriverSig, driverPaths, setDriverSignaturePaths, doConfirmPickup]);

  if (!load) {
    return (
      <ScreenContainer className="p-6">
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
          Load not found.
        </Text>
      </ScreenContainer>
    );
  }

  const headerTitle =
    mode === "choose" ? "Pickup Signature" :
    mode === "customer_sig" ? "Customer Signature" :
    "Driver Signature";

  const handleBack = () => {
    if (mode === "choose") {
      router.back();
    } else if (mode === "customer_sig") {
      setMode("choose");
      setCustomerPaths([]);
    } else if (mode === "driver_sig") {
      if (customerNotAvailable) {
        setMode("choose");
      } else {
        setMode("customer_sig");
      }
      setDriverPaths([]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Nav Header */}
      <View style={[styles.navHeader, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>{headerTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        {/* ── Choose Mode ──────────────────────────────────────────────────── */}
        {mode === "choose" && (
          <View>
            <Text style={[styles.sectionDesc, { color: colors.muted }]}>
              Select how you would like to capture the pickup confirmation for{" "}
              <Text style={{ fontWeight: "600", color: colors.foreground }}>
                Load #{load.loadNumber}
              </Text>
              .
            </Text>

            <OptionButton
              icon="person.2.fill"
              title="Add Customer Signature"
              subtitle="Customer is present — capture both customer and driver signatures"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCustomerNotAvailable(false);
                setMode("customer_sig");
              }}
              color={colors.primary}
            />

            <OptionButton
              icon="person.crop.circle.badge.xmark"
              title="Mark as Customer Not Available"
              subtitle={
                hasSavedDriverSig
                  ? "⚡ Saved signature will be used — confirms instantly"
                  : "Customer was not present — you'll sign once to confirm (saved for future use)"
              }
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCustomerNotAvailable(true);
                if (hasSavedDriverSig) {
                  // Auto-apply saved signature and confirm immediately — no screen needed
                  const savedSig = savedDriverPaths.map((p) => p.d).join(" ");
                  doConfirmPickup(savedSig, true);
                } else {
                  // First time — show driver sig screen so they can sign once
                  setMode("driver_sig");
                }
              }}
              color={colors.warning}
            />

            <OptionButton
              icon="hand.raised.fill"
              title="Skip Signature"
              subtitle="Proceed without a signature — not recommended"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert(
                  "Skip Signature?",
                  "Are you sure you want to proceed without capturing any signature? This may affect your proof of pickup.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Skip", style: "destructive", onPress: () => doConfirmPickup() },
                  ]
                );
              }}
              color={colors.muted}
            />
          </View>
        )}

        {/* ── Customer Signature ───────────────────────────────────────────── */}
        {mode === "customer_sig" && (
          <View>
            <Text style={[styles.sectionDesc, { color: colors.muted }]}>
              Hand the device to the customer and ask them to sign in the box below.
            </Text>
            {/* Customer Name Field */}
            <View style={[styles.nameFieldWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.nameFieldLabel, { color: colors.muted }]}>CUSTOMER NAME</Text>
              <TextInput
                style={[styles.nameFieldInput, { color: colors.foreground }]}
                placeholder="Enter customer name"
                placeholderTextColor={colors.muted}
                value={customerName}
                onChangeText={setCustomerName}
                returnKeyType="done"
                autoCapitalize="words"
              />
            </View>
            <SignaturePad
              label="Customer Signature"
              paths={customerPaths}
              onPathsChange={setCustomerPaths}
              accentColor={colors.primary}
              onDrawStart={() => setScrollEnabled(false)}
              onDrawEnd={() => setScrollEnabled(true)}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: hasCustomerSig ? colors.primary : colors.border }]}
              onPress={() => {
                if (!hasCustomerSig) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMode("driver_sig");
              }}
              activeOpacity={hasCustomerSig ? 0.85 : 1}
            >
              <Text style={[styles.primaryBtnText, { color: hasCustomerSig ? "#FFFFFF" : colors.muted }]}>
                Continue to Driver Signature
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Driver Signature ─────────────────────────────────────────────── */}
        {mode === "driver_sig" && (
          <View>
            {customerNotAvailable && (
              <View style={[styles.noticeBanner, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "40" }]}>
                <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.warning} />
                <Text style={[styles.noticeText, { color: colors.warning }]}>
                  Customer not available — driver signature only
                </Text>
              </View>
            )}

            {/* First-time save notice */}
            {!hasSavedDriverSig && customerNotAvailable && (
              <View style={[styles.infoBox, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <IconSymbol name="info.circle.fill" size={15} color={colors.primary} />
                <Text style={[styles.infoText, { color: colors.primary }]}>
                  Your signature will be saved automatically. Future "Customer Not Available" taps will confirm instantly without asking you to sign again.
                </Text>
              </View>
            )}

            <Text style={[styles.sectionDesc, { color: colors.muted }]}>
              {customerNotAvailable
                ? "Sign below to confirm you picked up the vehicle(s) without the customer present."
                : "Now sign below as the driver to complete the pickup confirmation."}
            </Text>
            <SignaturePad
              label="Driver Signature"
              paths={driverPaths}
              onPathsChange={setDriverPaths}
              accentColor={colors.success}
              onDrawStart={() => setScrollEnabled(false)}
              onDrawEnd={() => setScrollEnabled(true)}
            />
            {/* Confirm button appears as soon as driver has signed — no review step */}
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: hasDriverSig ? colors.success : colors.border, opacity: isConfirming ? 0.7 : 1 }]}
              onPress={handleDriverSigConfirm}
              activeOpacity={hasDriverSig ? 0.85 : 1}
              disabled={isConfirming}
            >
              <IconSymbol name="checkmark.circle.fill" size={22} color={hasDriverSig ? "#FFFFFF" : colors.muted} />
              <Text style={[styles.confirmBtnText, { color: hasDriverSig ? "#FFFFFF" : colors.muted }]}>
                {isConfirming ? "Confirming..." : "Mark as Picked Up"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
  },
  backBtn: { width: 40, padding: 4 },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  sectionDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 18,
    marginTop: 8,
  },
  confirmBtnText: {
    fontSize: 17,
    fontWeight: "700",
  },
  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  nameFieldWrap: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  nameFieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  nameFieldInput: {
    fontSize: 16,
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 2,
  },
});
