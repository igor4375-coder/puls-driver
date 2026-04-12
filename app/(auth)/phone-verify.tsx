import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSignUp, useSignIn, useClerk } from "@clerk/expo";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const CODE_LENGTH = 6;

export default function VerifyScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{
    phoneNumber?: string;
    displayPhone?: string;
    identifier?: string;
    displayIdentifier?: string;
    isExistingUser: string;
    flow: string;
    method?: string;
  }>();

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const { signUp } = useSignUp();
  const { signIn } = useSignIn();
  const clerk = useClerk();

  const isSignIn = params.flow === "signIn";
  const isEmail = params.method === "email";

  const si = signIn as any;
  const su = signUp as any;

  const navigateToApp = () => {
    while (router.canGoBack()) router.back();
    setTimeout(() => router.replace("/(tabs)"), 100);
  };

  const displayValue = params.displayIdentifier ?? params.displayPhone ?? "";
  const enteredCode = digits.join("");
  const isCodeComplete = enteredCode.length === CODE_LENGTH;

  useEffect(() => {
    setTimeout(() => inputRefs.current[0]?.focus(), 300);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      const newDigits = [...digits];
      newDigits[index] = "";
      setDigits(newDigits);
      if (index > 0) inputRefs.current[index - 1]?.focus();
      return;
    }

    if (cleaned.length === CODE_LENGTH) {
      const newDigits = cleaned.split("").slice(0, CODE_LENGTH);
      setDigits(newDigits);
      inputRefs.current[CODE_LENGTH - 1]?.focus();
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = cleaned[0];
    setDigits(newDigits);
    setError("");

    if (index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (!isCodeComplete) return;
    setError("");
    setIsVerifying(true);

    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      if (isSignIn) {
        if (!si) {
          throw new Error("Sign-in session expired. Please go back and try again.");
        }

        // Verify the code using the new API
        const verifyFn = isEmail
          ? si.emailCode?.verifyCode
          : si.phoneCode?.verifyCode;

        if (!verifyFn) {
          throw new Error("Verification method unavailable. Please go back and try again.");
        }

        const { error: verifyErr } = await (isEmail
          ? si.emailCode.verifyCode({ code: enteredCode })
          : si.phoneCode.verifyCode({ code: enteredCode }));

        if (verifyErr) {
          const msg =
            (verifyErr as any).errors?.[0]?.longMessage ??
            (verifyErr as any).errors?.[0]?.message ??
            verifyErr.longMessage ??
            verifyErr.message ??
            "Invalid code. Please try again.";
          setError(msg);
          setDigits(Array(CODE_LENGTH).fill(""));
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
          return;
        }

        if (si.status === "complete") {
          const { error: finalizeErr } = await si.finalize();
          if (finalizeErr) {
            console.log("[Verify] finalize error:", finalizeErr.message);
          }
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          navigateToApp();
        } else {
          console.log("[Verify] SignIn status after verify:", si.status);
          setError("Verification incomplete. Please try again.");
        }
      } else {
        // Sign-Up verification
        if (!su) {
          throw new Error("Sign-up session expired. Please go back and try again.");
        }

        const { error: verifyErr } = await (isEmail
          ? su.verifications.verifyEmailCode({ code: enteredCode })
          : su.verifications.verifyPhoneCode({ code: enteredCode }));

        if (verifyErr) {
          const msg =
            (verifyErr as any).errors?.[0]?.longMessage ??
            (verifyErr as any).errors?.[0]?.message ??
            verifyErr.longMessage ??
            verifyErr.message ??
            "Invalid code. Please try again.";
          setError(msg);
          setDigits(Array(CODE_LENGTH).fill(""));
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
          return;
        }

        console.log("[Verify] SignUp status after verify:", su.status);

        if (su.status === "complete") {
          const { error: finalizeErr } = await su.finalize();
          if (finalizeErr) {
            console.log("[Verify] finalize error:", finalizeErr.message);
          }
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          navigateToApp();
        } else if (su.status === "missing_requirements") {
          const missing = su.missingFields || [];
          const unverified = su.unverifiedFields || [];
          console.log("[Verify] missing_requirements — missing:", missing, "unverified:", unverified);

          if (missing.length === 0 && unverified.length === 0) {
            const { error: finalizeErr } = await su.finalize();
            if (finalizeErr) {
              setError(`Sign-up incomplete: ${finalizeErr.longMessage ?? finalizeErr.message}`);
            } else {
              navigateToApp();
            }
          } else {
            setError(
              `Additional info needed: ${missing.join(", ") || unverified.join(", ")}. Please try again.`,
            );
          }
        } else {
          setError(`Verification status: ${su.status}. Please try again.`);
        }
      }
    } catch (err: any) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      console.log("[Verify] Error:", JSON.stringify(err, null, 2));
      const clerkError = err?.errors?.[0];
      setError(
        clerkError?.longMessage ??
          clerkError?.message ??
          err?.message ??
          "Invalid code. Please try again.",
      );
      setDigits(Array(CODE_LENGTH).fill(""));
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      if (isSignIn) {
        if (!si) throw new Error("Sign-in session expired. Please go back and try again.");
        const { error: resendErr } = await (isEmail
          ? si.emailCode.sendCode()
          : si.phoneCode.sendCode());
        if (resendErr) {
          setError(resendErr.longMessage ?? resendErr.message ?? "Failed to resend code.");
          return;
        }
      } else {
        if (!su) throw new Error("Sign-up session expired. Please go back and try again.");
        const { error: resendErr } = await (isEmail
          ? su.verifications.sendEmailCode()
          : su.verifications.sendPhoneCode());
        if (resendErr) {
          setError(resendErr.longMessage ?? resendErr.message ?? "Failed to resend code.");
          return;
        }
      }
      setResendCooldown(30);
      setDigits(Array(CODE_LENGTH).fill(""));
      setError("");
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      console.log("[Verify] Resend error:", JSON.stringify(err, null, 2));
      setError(err?.errors?.[0]?.message ?? err?.message ?? "Failed to resend code.");
    }
  };

  const sentVia = isEmail ? "email" : "SMS";

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {isSignIn ? "Welcome back!" : "Verify your " + (isEmail ? "email" : "number")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Enter the 6-digit code sent via {sentVia} to{"\n"}
              <Text style={{ fontWeight: "700", color: colors.foreground }}>
                {displayValue}
              </Text>
            </Text>
          </View>

          <View style={styles.codeRow}>
            {Array(CODE_LENGTH)
              .fill(0)
              .map((_, i) => (
                <TextInput
                  key={i}
                  ref={(ref) => {
                    inputRefs.current[i] = ref;
                  }}
                  style={[
                    styles.codeBox,
                    {
                      borderColor: error ? colors.error : digits[i] ? colors.primary : colors.border,
                      backgroundColor: colors.surface,
                      color: colors.foreground,
                    },
                  ]}
                  value={digits[i]}
                  onChangeText={(v) => handleDigitChange(i, v)}
                  onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={CODE_LENGTH}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
          </View>

          {!!error && <Text style={[styles.error, { color: colors.error }]}>{error}</Text>}

          <TouchableOpacity
            style={[
              styles.verifyBtn,
              {
                backgroundColor: isCodeComplete && !isVerifying ? colors.primary : colors.border,
              },
            ]}
            onPress={handleVerify}
            disabled={!isCodeComplete || isVerifying}
          >
            {isVerifying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.verifyBtnText}>
                {isSignIn ? "Sign In" : "Verify & Create Account"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendBtn}
            onPress={handleResend}
            disabled={resendCooldown > 0}
          >
            <Text
              style={[
                styles.resendText,
                { color: resendCooldown > 0 ? colors.muted : colors.primary },
              ]}
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Didn't receive a code? Resend"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: 24 },
  backBtn: { marginBottom: 24 },
  backText: { fontSize: 16, fontWeight: "500" },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 10, lineHeight: 36 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  codeRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 16 },
  codeBox: { width: 48, height: 58, borderWidth: 1.5, borderRadius: 12, fontSize: 24, fontWeight: "700" },
  error: { fontSize: 13, textAlign: "center", marginBottom: 12 },
  verifyBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8, marginBottom: 16 },
  verifyBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  resendBtn: { alignItems: "center", paddingVertical: 10 },
  resendText: { fontSize: 14, fontWeight: "500" },
});
