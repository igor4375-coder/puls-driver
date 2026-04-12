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
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSignUp, useSignIn, useClerk, useAuth } from "@clerk/expo";
import { nukeAllClerkTokens } from "@/lib/clerk-token-cache";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export default function EmailEntryScreen() {
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const { isSignedIn } = useAuth();
  const { signUp } = useSignUp();
  const { signIn } = useSignIn();
  const clerk = useClerk();

  useEffect(() => {
    if (isSignedIn) {
      while (router.canGoBack()) router.back();
      setTimeout(() => router.replace("/(tabs)"), 100);
    }
  }, [isSignedIn]);

  const isValidEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSend = async () => {
    if (!isValidEmail()) {
      setError("Please enter a valid email address");
      return;
    }

    setError("");
    setIsLoading(true);
    const trimmedEmail = email.trim().toLowerCase();

    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const si = signIn as any;

      if (!si) {
        throw Object.assign(new Error("SignIn unavailable"), {
          errors: [{ code: "form_identifier_not_found" }],
        });
      }

      const { error: createErr } = await si.create({ identifier: trimmedEmail });

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
      } else {
        if (si.status === "needs_first_factor") {
          const hasEmailCode = si.supportedFirstFactors?.some(
            (f: any) => f.strategy === "email_code",
          );
          const ssoFactor = si.supportedFirstFactors?.find(
            (f: any) => f.strategy?.startsWith("oauth_"),
          );

          if (hasEmailCode) {
            const { error: sendErr } = await si.emailCode.sendCode();

            if (sendErr) {
              setError(sendErr.longMessage ?? sendErr.message ?? "Failed to send code");
              return;
            }

            router.push({
              pathname: "/(auth)/phone-verify" as any,
              params: {
                identifier: trimmedEmail,
                displayIdentifier: trimmedEmail,
                isExistingUser: "1",
                flow: "signIn",
                method: "email",
              },
            });
            return;
          }

          if (ssoFactor) {
            const provider = ssoFactor.strategy.replace("oauth_", "");
            const label =
              provider === "google"
                ? "Google"
                : provider === "apple"
                  ? "Apple"
                  : provider;
            setError(
              `This account uses ${label} sign-in. Go back and tap "Continue with ${label}".`,
            );
            return;
          }

          setError("No supported sign-in method found for this account.");
          return;
        }

        if (si.status === "complete") {
          await si.finalize();
          while (router.canGoBack()) router.back();
          setTimeout(() => router.replace("/(tabs)"), 100);
          return;
        }

        setError("Unexpected sign-in state. Please try again.");
        return;
      }

      // --- Sign-Up flow (new user) ---
      const su = signUp as any;

      if (!su) {
        setError("Sign-up unavailable. Please try again.");
        return;
      }

      const { error: suCreateErr } = await su.create({
        emailAddress: trimmedEmail,
      });

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

      if (su.status === "complete") {
        await su.finalize();
        while (router.canGoBack()) router.back();
        setTimeout(() => router.replace("/(tabs)"), 100);
        return;
      }

      const { error: sendErr } = await su.verifications.sendEmailCode();

      if (sendErr) {
        setError(sendErr.longMessage ?? sendErr.message ?? "Failed to send verification code");
        return;
      }

      router.push({
        pathname: "/(auth)/phone-verify" as any,
        params: {
          identifier: trimmedEmail,
          displayIdentifier: trimmedEmail,
          isExistingUser: "0",
          flow: "signUp",
          method: "email",
        },
      });
    } catch (err: any) {
      const isStaleSession =
        err?.errors?.some(
          (e: any) =>
            e.code === "session_exists" ||
            e.code === "identifier_already_signed_in" ||
            e.message?.toLowerCase().includes("already signed in"),
        ) || err?.message?.toLowerCase().includes("already signed in");

      if (isStaleSession) {
        try {
          await clerk.signOut();
        } catch (_) {}
        await nukeAllClerkTokens();
        setError("Session cleared. Please try again.");
      } else {
        const clerkError = err?.errors?.[0];
        setError(
          clerkError?.longMessage ??
            clerkError?.message ??
            err?.message ??
            "Sign-in failed. Please try again.",
        );
      }
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
              What's your email?
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              We'll send a verification code to confirm your identity.
            </Text>
          </View>

          <TextInput
            ref={inputRef}
            style={[
              styles.emailInput,
              {
                borderColor: error ? colors.error : colors.border,
                backgroundColor: colors.surface,
                color: colors.foreground,
              },
            ]}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError("");
            }}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />

          {!!error && <Text style={[styles.error, { color: colors.error }]}>{error}</Text>}

          <TouchableOpacity
            style={[
              styles.sendBtn,
              { backgroundColor: isValidEmail() && !isLoading ? colors.primary : colors.border },
            ]}
            onPress={handleSend}
            disabled={!isValidEmail() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendBtnText}>Send Verification Code</Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: colors.muted }]}>
            We'll send a one-time code to verify your email address.
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
  emailInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },
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
