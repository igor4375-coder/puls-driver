import React, { useState, useRef } from "react";
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
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSignUp, useSignIn } from "@clerk/expo";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const COUNTRY_CODES = [
  { code: "+1", flag: "\u{1F1FA}\u{1F1F8}", label: "US/CA" },
  { code: "+44", flag: "\u{1F1EC}\u{1F1E7}", label: "UK" },
  { code: "+61", flag: "\u{1F1E6}\u{1F1FA}", label: "AU" },
  { code: "+52", flag: "\u{1F1F2}\u{1F1FD}", label: "MX" },
];

export default function PhoneEntryScreen() {
  const colors = useColors();
  const [countryCode, setCountryCode] = useState("+1");
  const [phone, setPhone] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const { signUp } = useSignUp();
  const { signIn } = useSignIn();

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (countryCode === "+1") {
      if (digits.length <= 3) return digits;
      if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
    return digits;
  };

  const getFullNumber = () => {
    const digits = phone.replace(/\D/g, "");
    return `${countryCode}${digits}`;
  };

  const isValidPhone = () => {
    const digits = phone.replace(/\D/g, "");
    if (countryCode === "+1") return digits.length === 10;
    return digits.length >= 7;
  };

  const handleSend = async () => {
    if (!isValidPhone()) {
      setError("Please enter a valid phone number");
      return;
    }

    setError("");
    setIsLoading(true);
    const fullNumber = getFullNumber();
    const si = signIn as any;
    const su = signUp as any;

    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      // --- Sign-In attempt (existing user) ---
      let userNotFound = false;

      if (si) {
        const { error: createErr } = await si.create({ identifier: fullNumber });

        if (createErr) {
          const isNotFound =
            createErr.code === "form_identifier_not_found" ||
            createErr.code === "form_param_nil" ||
            (createErr as any).errors?.some(
              (e: any) =>
                e.code === "form_identifier_not_found" ||
                e.code === "form_param_nil",
            );

          if (!isNotFound) {
            const msg =
              (createErr as any).errors?.[0]?.longMessage ??
              (createErr as any).errors?.[0]?.message ??
              createErr.longMessage ??
              createErr.message ??
              "Sign-in failed";
            setError(msg);
            return;
          }
          userNotFound = true;
        } else if (si.status === "needs_first_factor") {
          const hasPhoneCode = si.supportedFirstFactors?.some(
            (f: any) => f.strategy === "phone_code",
          );

          if (hasPhoneCode) {
            const { error: sendErr } = await si.phoneCode.sendCode();
            if (sendErr) {
              setError(sendErr.longMessage ?? sendErr.message ?? "Failed to send code");
              return;
            }

            router.push({
              pathname: "/(auth)/phone-verify" as any,
              params: {
                phoneNumber: fullNumber,
                displayPhone: `${countryCode} ${formatPhone(phone)}`,
                displayIdentifier: `${countryCode} ${formatPhone(phone)}`,
                isExistingUser: "1",
                flow: "signIn",
                method: "phone",
              },
            });
            return;
          }
        } else if (si.status === "complete") {
          await si.finalize();
          while (router.canGoBack()) router.back();
          setTimeout(() => router.replace("/(tabs)"), 100);
          return;
        }
      } else {
        userNotFound = true;
      }

      if (!userNotFound) return;

      // --- Sign-Up flow (new user) ---
      if (!su) {
        setError("Sign-up unavailable. Please try again.");
        return;
      }

      const { error: suCreateErr } = await su.create({ phoneNumber: fullNumber });

      if (suCreateErr) {
        const msg =
          (suCreateErr as any).errors?.[0]?.longMessage ??
          (suCreateErr as any).errors?.[0]?.message ??
          suCreateErr.longMessage ??
          suCreateErr.message ??
          "Sign-up failed";
        setError(msg);
        return;
      }

      const { error: sendErr } = await su.verifications.sendPhoneCode();

      if (sendErr) {
        setError(sendErr.longMessage ?? sendErr.message ?? "Failed to send verification code");
        return;
      }

      router.push({
        pathname: "/(auth)/phone-verify" as any,
        params: {
          phoneNumber: fullNumber,
          displayPhone: `${countryCode} ${formatPhone(phone)}`,
          displayIdentifier: `${countryCode} ${formatPhone(phone)}`,
          isExistingUser: "0",
          flow: "signUp",
          method: "phone",
        },
      });
    } catch (err: any) {
      console.log("[PhoneEntry] Full error:", JSON.stringify(err, null, 2));
      const clerkError = err?.errors?.[0];
      const errorMsg =
        clerkError?.longMessage ??
        clerkError?.message ??
        err?.message ??
        "Failed to send verification code. Please try again.";
      setError(errorMsg);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsLoading(false);
    }
  };

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
              What's your number?
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              We'll send a verification code via SMS to confirm your identity.
            </Text>
          </View>

          <View style={styles.inputRow}>
            <TouchableOpacity
              style={[styles.countryBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => setShowCountryPicker(!showCountryPicker)}
            >
              <Text style={[styles.countryFlag, { color: colors.foreground }]}>
                {COUNTRY_CODES.find((c) => c.code === countryCode)?.flag ?? "\u{1F310}"}{" "}
                {countryCode}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{"\u25BC"}</Text>
            </TouchableOpacity>

            <TextInput
              ref={inputRef}
              style={[
                styles.phoneInput,
                { borderColor: error ? colors.error : colors.border, backgroundColor: colors.surface, color: colors.foreground },
              ]}
              value={formatPhone(phone)}
              onChangeText={(text) => {
                setPhone(text.replace(/\D/g, ""));
                setError("");
              }}
              placeholder={countryCode === "+1" ? "(555) 000-0000" : "Phone number"}
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              autoFocus
              maxLength={countryCode === "+1" ? 14 : 15}
            />
          </View>

          {showCountryPicker && (
            <View style={[styles.countryList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {COUNTRY_CODES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[
                    styles.countryItem,
                    countryCode === c.code && { backgroundColor: `${colors.primary}15` },
                  ]}
                  onPress={() => {
                    setCountryCode(c.code);
                    setShowCountryPicker(false);
                  }}
                >
                  <Text style={[styles.countryItemText, { color: colors.foreground }]}>
                    {c.flag} {c.label} ({c.code})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!!error && <Text style={[styles.error, { color: colors.error }]}>{error}</Text>}

          <TouchableOpacity
            style={[
              styles.sendBtn,
              { backgroundColor: isValidPhone() && !isLoading ? colors.primary : colors.border },
            ]}
            onPress={handleSend}
            disabled={!isValidPhone() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendBtnText}>Send Verification Code</Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: colors.muted }]}>
            By continuing, you agree to receive an SMS for verification. Standard messaging rates
            may apply.
          </Text>
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
  inputRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  countryBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  countryFlag: { fontSize: 16, fontWeight: "600" },
  phoneInput: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  countryList: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  countryItem: { paddingVertical: 12, paddingHorizontal: 16 },
  countryItemText: { fontSize: 15, fontWeight: "500" },
  error: { fontSize: 13, marginBottom: 12 },
  sendBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  sendBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  disclaimer: { fontSize: 12, lineHeight: 17, textAlign: "center" },
});
