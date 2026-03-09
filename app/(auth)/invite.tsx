import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { IconSymbol } from "@/components/ui/icon-symbol";

/**
 * Join a Company screen — supports two entry methods:
 *
 * 1. C-XXXXX company code (new identity system):
 *    Driver enters the company's C-XXXXX code → backend looks up the company
 *    and creates a pending driver_company_link → driver confirms → link becomes active.
 *
 * 2. Legacy 8-character invite code (e.g. ABC12345):
 *    Dispatcher generated a one-time code → driver enters it → backend validates
 *    and accepts the invitation → driver is linked to the company.
 *
 * The screen auto-detects which path to use based on the format of the entered code.
 */

type Step = "enter_code" | "preview_company" | "success";

/** Detected code type */
type CodeType = "company_code" | "legacy_invite" | "unknown";

interface CompanyPreview {
  /** The raw code the driver entered */
  code: string;
  codeType: CodeType;
  companyName: string;
  companyCode?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  driverName?: string | null;
  expiresAt?: Date | string | null;
  /** For C-XXXXX flow: the company DB id */
  companyId?: number;
}

/** Detect whether the entered code looks like a C-XXXXX company code or a legacy invite code */
function detectCodeType(code: string): CodeType {
  // C-XXXXX format: starts with C- followed by 5 digits
  if (/^C-\d{5}$/.test(code)) return "company_code";
  // Legacy: 4–16 alphanumeric characters
  if (/^[A-Z0-9]{4,16}$/.test(code)) return "legacy_invite";
  return "unknown";
}

export default function InviteScreen() {
  const colors = useColors();
  const [step, setStep] = useState<Step>("enter_code");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<CompanyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);

  const utils = trpc.useUtils();

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /** Accept a legacy invite code */
  const acceptLegacyMutation = trpc.driver.acceptInvitation.useMutation({
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("success");
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Could Not Join", err.message ?? "Something went wrong. Please try again.");
    },
  });

  /** Request to join a company via C-XXXXX code (creates a pending link) */
  const requestJoinMutation = trpc.driver.requestJoinByCompanyCode.useMutation({
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("success");
    },
    onError: (err: { message?: string }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Could Not Send Request", err.message ?? "Something went wrong. Please try again.");
    },
  });

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleLookupCode = async () => {
    const trimmed = code.trim().toUpperCase();
    const codeType = detectCodeType(trimmed);

    if (codeType === "unknown") {
      Alert.alert(
        "Invalid Code",
        "Please enter a valid Company ID (e.g. C-22341) or an invitation code from your dispatcher."
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);

    try {
      if (codeType === "company_code") {
        // Look up company by C-XXXXX code
        const result = await utils.driver.lookupCompanyByCode.fetch({ companyCode: trimmed });
        setPreview({
          code: trimmed,
          codeType: "company_code",
          companyName: result.name,
          companyCode: result.companyCode,
          companyEmail: result.email,
          companyPhone: result.phone,
          companyId: result.id,
        });
      } else {
        // Look up legacy invite code
        const result = await utils.driver.previewInvitation.fetch({ code: trimmed });
        setPreview({
          code: trimmed,
          codeType: "legacy_invite",
          companyName: result.companyName,
          companyCode: result.companyCode,
          companyEmail: result.companyEmail,
          companyPhone: result.companyPhone,
          driverName: result.driverName,
          expiresAt: result.expiresAt,
        });
      }
      setStep("preview_company");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Not Found",
        err?.message ?? "That code is not valid or has expired. Please check with your dispatcher."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmJoin = async () => {
    if (!preview) return;
    setJoining(true);
    try {
      if (preview.codeType === "company_code") {
        await requestJoinMutation.mutateAsync({ companyCode: preview.code });
      } else {
        await acceptLegacyMutation.mutateAsync({ code: preview.code });
      }
    } finally {
      setJoining(false);
    }
  };

  const handleGoToApp = () => {
    router.replace("/(tabs)");
  };

  const isCompanyCodeFlow = preview?.codeType === "company_code";

  // ─── Step: Enter Code ─────────────────────────────────────────────────────────
  if (step === "enter_code") {
    const codeType = detectCodeType(code.trim().toUpperCase());
    const isValid = codeType !== "unknown" && code.trim().length >= 4;

    return (
      <ScreenContainer>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
            {/* Back button */}
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <IconSymbol name="chevron.left" size={16} color={colors.primary} />
              <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
            </TouchableOpacity>

            <View style={styles.content}>
              {/* Icon */}
              <View style={[styles.iconContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <IconSymbol name="building.2.fill" size={40} color={colors.primary} />
              </View>

              <Text style={[styles.title, { color: colors.foreground }]}>Join a Company</Text>
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                Enter the company's Driver ID code (e.g. <Text style={{ fontWeight: "700" }}>C-22341</Text>) or an invitation code sent by your dispatcher.
              </Text>

              {/* Code input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.muted }]}>Company ID or Invitation Code</Text>
                <TextInput
                  style={[
                    styles.codeInput,
                    {
                      backgroundColor: colors.surface,
                      color: colors.foreground,
                      borderColor: isValid ? colors.primary : colors.border,
                    },
                  ]}
                  placeholder="C-22341 or ABC12345"
                  placeholderTextColor={colors.muted}
                  value={code}
                  onChangeText={(t) => {
                    // Allow C- prefix and digits/letters
                    const cleaned = t.toUpperCase().replace(/[^A-Z0-9\-]/g, "");
                    setCode(cleaned);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  maxLength={16}
                  onSubmitEditing={handleLookupCode}
                />
                {/* Code type hint */}
                {code.length >= 2 && (
                  <Text style={[styles.codeHint, { color: codeType === "company_code" ? colors.success : codeType === "legacy_invite" ? colors.primary : colors.muted }]}>
                    {codeType === "company_code" ? "✓ Company ID format" : codeType === "legacy_invite" ? "✓ Invitation code format" : "Enter a Company ID (C-XXXXX) or invite code"}
                  </Text>
                )}
              </View>

              {/* Lookup button */}
              <TouchableOpacity
                style={[styles.joinBtn, { backgroundColor: colors.primary }, (!isValid || loading) && { opacity: 0.5 }]}
                onPress={handleLookupCode}
                disabled={!isValid || loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.joinBtnText}>Look Up</Text>
                )}
              </TouchableOpacity>

              {/* How it works */}
              <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.infoTitle, { color: colors.foreground }]}>Two ways to join</Text>
                <View style={styles.infoRow}>
                  <View style={[styles.infoIconWrap, { backgroundColor: colors.primary + "18" }]}>
                    <IconSymbol name="building.2.fill" size={14} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.infoRowTitle, { color: colors.foreground }]}>Company ID (C-XXXXX)</Text>
                    <Text style={[styles.infoText, { color: colors.muted }]}>
                      Ask your dispatcher for their Company ID. Enter it here to send a join request — they'll approve you from their platform.
                    </Text>
                  </View>
                </View>
                <View style={[styles.infoRow, { marginTop: 12 }]}>
                  <View style={[styles.infoIconWrap, { backgroundColor: colors.warning + "18" }]}>
                    <IconSymbol name="envelope.fill" size={14} color={colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.infoRowTitle, { color: colors.foreground }]}>Invitation Code</Text>
                    <Text style={[styles.infoText, { color: colors.muted }]}>
                      If your dispatcher sent you an 8-character code via email or SMS, enter it here to join instantly.
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ─── Step: Preview Company ────────────────────────────────────────────────────
  if (step === "preview_company" && preview) {
    const expiryStr = preview.expiresAt
      ? new Date(preview.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;

    return (
      <ScreenContainer>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => { setStep("enter_code"); setPreview(null); }}
            activeOpacity={0.7}
          >
            <IconSymbol name="chevron.left" size={16} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Change Code</Text>
          </TouchableOpacity>

          <View style={styles.content}>
            {/* Company Card */}
            <View style={[styles.companyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.companyIconWrap, { backgroundColor: colors.primary + "18" }]}>
                <IconSymbol name="building.2.fill" size={36} color={colors.primary} />
              </View>

              <Text style={[styles.companyCardLabel, { color: colors.muted }]}>
                {isCompanyCodeFlow ? "You are requesting to join" : "You have been invited to join"}
              </Text>
              <Text style={[styles.companyCardName, { color: colors.foreground }]}>{preview.companyName}</Text>

              {preview.companyCode && (
                <View style={[styles.companyCodeBadge, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                  <IconSymbol name="building.2.fill" size={11} color={colors.primary} />
                  <Text style={[styles.companyCodeText, { color: colors.primary }]}>{preview.companyCode}</Text>
                </View>
              )}

              {preview.companyEmail && (
                <Text style={[styles.companyCardEmail, { color: colors.muted }]}>{preview.companyEmail}</Text>
              )}

              {preview.driverName && (
                <View style={[styles.driverNameBadge, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                  <IconSymbol name="person.fill" size={13} color={colors.primary} />
                  <Text style={[styles.driverNameText, { color: colors.primary }]}>
                    Invited as: {preview.driverName}
                  </Text>
                </View>
              )}

              {expiryStr && (
                <View style={[styles.expiryRow, { borderTopColor: colors.border }]}>
                  <IconSymbol name="clock.fill" size={13} color={colors.muted} />
                  <Text style={[styles.expiryText, { color: colors.muted }]}>Expires {expiryStr}</Text>
                </View>
              )}
            </View>

            {/* Info box for C-XXXXX flow */}
            {isCompanyCodeFlow && (
              <View style={[styles.infoBox, { backgroundColor: colors.primary + "0D", borderColor: colors.primary + "30" }]}>
                <IconSymbol name="info.circle.fill" size={16} color={colors.primary} />
                <Text style={[styles.infoText, { color: colors.foreground, flex: 1 }]}>
                  Your request will be sent to <Text style={{ fontWeight: "700" }}>{preview.companyName}</Text>. Once they approve it from their dispatch platform, you'll start receiving loads from them.
                </Text>
              </View>
            )}

            {/* Confirm Button */}
            <TouchableOpacity
              style={[styles.joinBtn, { backgroundColor: colors.primary }, joining && { opacity: 0.7 }]}
              onPress={handleConfirmJoin}
              disabled={joining}
              activeOpacity={0.85}
            >
              {joining ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.joinBtnText}>
                  {isCompanyCodeFlow ? `Send Join Request to ${preview.companyName}` : `Confirm & Join ${preview.companyName}`}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => { setStep("enter_code"); setPreview(null); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ─── Step: Success ────────────────────────────────────────────────────────────
  return (
    <ScreenContainer>
      <View style={styles.successContainer}>
        <View style={[styles.successIcon, { backgroundColor: colors.success + "18" }]}>
          <IconSymbol name="checkmark.circle.fill" size={64} color={colors.success} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>
          {isCompanyCodeFlow ? "Request Sent!" : "You're In!"}
        </Text>
        <Text style={[styles.successSubtitle, { color: colors.muted }]}>
          {isCompanyCodeFlow
            ? `Your join request has been sent to ${preview?.companyName ?? "the company"}. You'll receive a notification once they approve it.`
            : `You have successfully joined${preview?.companyName ? ` ${preview.companyName}` : " your company"}. Your dispatcher can now assign loads to you.`
          }
        </Text>
        <TouchableOpacity
          style={[styles.joinBtn, { backgroundColor: colors.primary, marginTop: 32 }]}
          onPress={handleGoToApp}
          activeOpacity={0.85}
        >
          <Text style={styles.joinBtnText}>View My Loads</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 15,
    fontWeight: "500",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 20,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  codeInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
  },
  codeHint: {
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  joinBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  infoBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    flexDirection: "column",
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoRowTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 19,
  },
  // Preview step
  companyCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  companyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  companyCardLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  companyCardName: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  companyCodeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  companyCodeText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  companyCardEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  driverNameBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  driverNameText: {
    fontSize: 13,
    fontWeight: "600",
  },
  expiryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    width: "100%",
    justifyContent: "center",
  },
  expiryText: {
    fontSize: 12,
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "500",
  },
  // Success step
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
