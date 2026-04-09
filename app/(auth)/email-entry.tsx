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
    // #region agent log — on-screen debug trace (session 887738)
    const _d: string[] = [];
    // #endregion

    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      // Try sign-in first (existing user)
      try {
        const si = signIn ?? clerk.client?.signIn;
        // #region agent log
        _d.push(`si=${signIn ? 'hook' : si ? 'client' : 'NULL'}`);
        fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'887738'},body:JSON.stringify({sessionId:'887738',location:'email-entry.tsx:58',message:'signIn source',data:{fromHook:!!signIn,fromClient:!!clerk.client?.signIn,email:trimmedEmail},timestamp:Date.now(),hypothesisId:'H-B'})}).catch(()=>{});
        // #endregion
        if (!si) throw Object.assign(new Error("SignIn unavailable"), { errors: [{ code: "form_identifier_not_found" }] });
        const result = await si.create({ identifier: trimmedEmail });
        // #region agent log
        const rawFactors = result.supportedFirstFactors;
        const factorType = rawFactors === undefined ? 'undefined' : rawFactors === null ? 'null' : Array.isArray(rawFactors) ? `array(${rawFactors.length})` : typeof rawFactors;
        const resultKeys = Object.keys(result ?? {}).join(',');
        _d.push(`signIn OK`);
        _d.push(`status=${result.status}`);
        _d.push(`factors=${factorType}`);
        _d.push(`keys=[${resultKeys}]`);
        if (Array.isArray(rawFactors) && rawFactors.length > 0) {
          _d.push(`strats=[${rawFactors.map((f:any) => f.strategy).join(',')}]`);
        }
        fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'887738'},body:JSON.stringify({sessionId:'887738',location:'email-entry.tsx:66',message:'signIn.create result',data:{status:result.status,factorType,resultKeys,rawFactors:JSON.stringify(rawFactors)?.slice(0,500)},timestamp:Date.now(),hypothesisId:'H-A,H-E'})}).catch(()=>{});
        // #endregion

        const allFactors = result.supportedFirstFactors?.map((f: any) => f.strategy) ?? [];

        const emailCodeFactor = result.supportedFirstFactors?.find(
          (f: any) => f.strategy === "email_code",
        ) as any;

        if (emailCodeFactor) {
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

        const ssoFactor = result.supportedFirstFactors?.find(
          (f: any) => f.strategy?.startsWith("oauth_"),
        ) as any;
        if (ssoFactor) {
          const provider = ssoFactor.strategy.replace("oauth_", "");
          const label =
            provider === "google" ? "Google" : provider === "apple" ? "Apple" : provider;
          setError(
            `This account uses ${label} sign-in. Go back and tap "Continue with ${label}".`,
          );
          return;
        }

        // #region agent log — show full trace on screen
        setError(`[DBG-887738] ${_d.join(' | ')}`);
        // #endregion
        return;
      } catch (signInErr: any) {
        const codes = signInErr?.errors?.map((e: any) => e.code) ?? [];
        // #region agent log
        _d.push(`signIn ERR: codes=[${codes.join(',')}] msg=${signInErr?.message?.slice(0,80)}`);
        fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'887738'},body:JSON.stringify({sessionId:'887738',location:'email-entry.tsx:117',message:'signIn catch',data:{codes,msg:signInErr?.message?.slice(0,200)},timestamp:Date.now(),hypothesisId:'H-A,H-C,H-D'})}).catch(()=>{});
        // #endregion
        const isUserNotFound = signInErr?.errors?.some(
          (e: any) =>
            e.code === "form_identifier_not_found" ||
            e.code === "form_param_nil",
        );
        if (!isUserNotFound) {
          throw signInErr;
        }
        _d.push(`user not found → signup`);
      }

      // Sign-up flow (new user)
      // #region agent log
      _d.push(`signUp start, hasSignUp=${!!signUp}`);
      fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'887738'},body:JSON.stringify({sessionId:'887738',location:'email-entry.tsx:135',message:'entering signUp',data:{hasSignUp:!!signUp},timestamp:Date.now(),hypothesisId:'H-C'})}).catch(()=>{});
      // #endregion
      const createResult = await signUp!.create({ emailAddress: trimmedEmail });
      // #region agent log
      _d.push(`signUp OK, status=${createResult.status}`);
      // #endregion

      if (createResult.status === "complete") {
        await setSignUpActive!({ session: createResult.createdSessionId });
        router.replace("/(tabs)");
        return;
      }

      const su = createResult as any;

      if (typeof su.prepareVerification === "function") {
        await su.prepareVerification({ strategy: "email_code" });
      } else if (typeof su.prepareEmailAddressVerification === "function") {
        await su.prepareEmailAddressVerification();
      } else {
        const fallback = signUp ?? clerk.client?.signUp;
        if (fallback && typeof (fallback as any).prepareVerification === "function") {
          await (fallback as any).prepareVerification({ strategy: "email_code" });
        } else if (fallback && typeof (fallback as any).prepareEmailAddressVerification === "function") {
          await (fallback as any).prepareEmailAddressVerification();
        } else {
          throw new Error("No email verification method found on SignUp");
        }
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
      // #region agent log
      _d.push(`OUTER ERR: ${err?.errors?.map((e:any)=>e.code).join(',') || err?.message?.slice(0,80)}`);
      fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'887738'},body:JSON.stringify({sessionId:'887738',location:'email-entry.tsx:180',message:'outer catch',data:{codes:err?.errors?.map((e:any)=>e.code),msg:err?.message?.slice(0,200),trace:_d.join(' | ')},timestamp:Date.now(),hypothesisId:'H-all'})}).catch(()=>{});
      // #endregion

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
        // #region agent log — show full trace on screen for outer errors too
        setError(`[DBG-887738] ${_d.join(' | ')}`);
        // #endregion
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
