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
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export default function EmailEntryScreen() {
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const { isSignedIn } = useAuth();
  const { signUp, setActive: setSignUpActive } = useSignUp();
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

      // Try sign-in first (existing user)
      try {
        const si = clerk.client.signIn;
        const result = await si.create({ identifier: trimmedEmail });
        console.log("[EmailEntry] signIn result status:", result.status);
        console.log("[EmailEntry] signIn supportedFirstFactors:", 
          result.supportedFirstFactors?.map((f: any) => f.strategy));

        const emailCodeFactor = result.supportedFirstFactors?.find(
          (f: any) => f.strategy === "email_code",
        ) as any;

        if (emailCodeFactor) {
          console.log("[EmailEntry] Found email_code factor, preparing...");
          await si.prepareFirstFactor({
            strategy: "email_code",
            emailAddressId: emailCodeFactor.emailAddressId,
          });

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
      } catch (signInErr: any) {
        console.log("[EmailEntry] signIn error:", signInErr?.message);
        console.log("[EmailEntry] signIn error codes:", 
          signInErr?.errors?.map((e: any) => e.code));
        const isUserNotFound = signInErr?.errors?.some(
          (e: any) =>
            e.code === "form_identifier_not_found" ||
            e.code === "form_param_nil",
        );
        if (!isUserNotFound) {
          throw signInErr;
        }
        console.log("[EmailEntry] User not found, falling through to sign-up");
      }

      // Sign-up flow (new user)
      const createResult = await signUp!.create({ emailAddress: trimmedEmail });
      console.log("[EmailEntry] signUp status after create:", createResult.status);
      console.log("[EmailEntry] signUp unverifiedFields:", createResult.unverifiedFields);

      // If sign-up completed immediately (no verification needed)
      if (createResult.status === "complete") {
        await setSignUpActive!({ session: createResult.createdSessionId });
        router.replace("/(tabs)");
        return;
      }

      // Need verification — try multiple approaches for compatibility
      const su = clerk.client.signUp;
      console.log("[EmailEntry] clerk.client.signUp available methods:", 
        typeof su.prepareVerification,
        typeof su.prepareEmailAddressVerification,
        typeof (su as any).__internal_future?.verifications?.sendEmailCode,
      );

      if (typeof su.prepareVerification === "function") {
        await su.prepareVerification({ strategy: "email_code" });
      } else if (typeof su.prepareEmailAddressVerification === "function") {
        await su.prepareEmailAddressVerification();
      } else if (typeof (su as any).__internal_future?.verifications?.sendEmailCode === "function") {
        await (su as any).__internal_future.verifications.sendEmailCode();
      } else {
        const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(su));
        console.log("[EmailEntry] SignUp prototype methods:", proto);
        console.log("[EmailEntry] SignUp own keys:", Object.keys(su));
        throw new Error(
          "No email verification method found on SignUp. Available: " + proto.join(", ")
        );
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
      console.log("[EmailEntry] Error type:", err?.constructor?.name);
      console.log("[EmailEntry] Error message:", err?.message);
      console.log("[EmailEntry] Error stack:", err?.stack?.slice(0, 500));
      console.log("[EmailEntry] Clerk errors:", JSON.stringify(err?.errors, null, 2));
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
