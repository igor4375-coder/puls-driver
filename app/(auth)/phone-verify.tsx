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

  const { signUp, setActive: setSignUpActive } = useSignUp();
  const { signIn, setActive: setSignInActive } = useSignIn();
  const clerk = useClerk();

  const isSignIn = params.flow === "signIn";

  const navigateToApp = () => {
    while (router.canGoBack()) router.back();
    setTimeout(() => navigateToApp(), 100);
  };
  const isEmail = params.method === "email";
  const strategy = isEmail ? "email_code" : "phone_code";
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
        const si = clerk.client.signIn;
        const result = await si.attemptFirstFactor({
          strategy: strategy as any,
          code: enteredCode,
        });

        if (result.status === "complete") {
          await setSignInActive!({ session: result.createdSessionId });
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          navigateToApp();
        } else {
          console.log("[Verify] SignIn status:", result.status);
          setError("Verification incomplete. Please try again.");
        }
      } else {
        const su = clerk.client.signUp;
        let result: any;

        if (typeof su.attemptVerification === "function") {
          result = await su.attemptVerification({
            strategy: strategy as any,
            code: enteredCode,
          });
        } else if (isEmail && typeof su.attemptEmailAddressVerification === "function") {
          result = await su.attemptEmailAddressVerification({ code: enteredCode });
        } else if (!isEmail && typeof su.attemptPhoneNumberVerification === "function") {
          result = await su.attemptPhoneNumberVerification({ code: enteredCode });
        } else {
          const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(su));
          console.log("[Verify] SignUp methods:", proto);
          throw new Error("No attempt verification method found. Available: " + proto.join(", "));
        }

        console.log("[Verify] Result status:", result.status);
        console.log("[Verify] Result missingFields:", result.missingFields);
        console.log("[Verify] Result unverifiedFields:", result.unverifiedFields);
        console.log("[Verify] Result createdSessionId:", result.createdSessionId);
        console.log("[Verify] Result createdUserId:", result.createdUserId);

        if (result.status === "complete") {
          await setSignUpActive!({ session: result.createdSessionId });
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          navigateToApp();
        } else if (result.status === "missing_requirements") {
          // Email verified but Clerk wants more info — check if we can skip
          const missing = result.missingFields || [];
          const unverified = result.unverifiedFields || [];
          console.log("[Verify] missing_requirements — missing:", missing, "unverified:", unverified);

          // If no truly required fields remain, try to complete anyway
          if (missing.length === 0 && unverified.length === 0 && result.createdSessionId) {
            await setSignUpActive!({ session: result.createdSessionId });
            navigateToApp();
          } else if (missing.length === 0 && unverified.length === 0) {
            // No missing/unverified but no session yet — try setting active from clerk client
            const su = clerk.client.signUp;
            console.log("[Verify] Trying clerk.client.signUp.status:", su.status);
            console.log("[Verify] Trying clerk.client.signUp.createdSessionId:", su.createdSessionId);
            if (su.createdSessionId) {
              await setSignUpActive!({ session: su.createdSessionId });
              navigateToApp();
            } else {
              setError(`Sign-up incomplete. Status: ${result.status}. Please try again.`);
            }
          } else {
            setError(
              `Additional info needed: ${missing.join(", ") || unverified.join(", ")}. Please try again.`
            );
          }
        } else {
          setError(`Verification status: ${result.status}. Please try again.`);
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
        const si = clerk.client.signIn;
        if (isEmail) {
          const emailCodeFactor = si.supportedFirstFactors?.find(
            (f: any) => f.strategy === "email_code",
          ) as any;
          if (emailCodeFactor) {
            await si.prepareFirstFactor({
              strategy: "email_code",
              emailAddressId: emailCodeFactor.emailAddressId,
            });
          }
        } else {
          const phoneCodeFactor = si.supportedFirstFactors?.find(
            (f: any) => f.strategy === "phone_code",
          ) as any;
          if (phoneCodeFactor) {
            await si.prepareFirstFactor({
              strategy: "phone_code",
              phoneNumberId: phoneCodeFactor.phoneNumberId,
            });
          }
        }
      } else {
        const su = clerk.client.signUp;
        if (typeof su.prepareVerification === "function") {
          await su.prepareVerification({ strategy: strategy as any });
        } else if (isEmail && typeof su.prepareEmailAddressVerification === "function") {
          await su.prepareEmailAddressVerification();
        } else if (!isEmail && typeof su.preparePhoneNumberVerification === "function") {
          await su.preparePhoneNumberVerification();
        }
      }
      setResendCooldown(30);
      setDigits(Array(CODE_LENGTH).fill(""));
      setError("");
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      console.log("[Verify] Resend error:", JSON.stringify(err, null, 2));
      setError(err?.errors?.[0]?.message ?? "Failed to resend code.");
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
