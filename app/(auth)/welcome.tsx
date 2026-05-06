import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useSSO, useAuth, useClerk } from "@clerk/expo";
import * as Clipboard from "expo-clipboard";
import { nukeAllClerkTokens } from "@/lib/clerk-token-cache";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

// #region agent log
import AsyncStorage from "@react-native-async-storage/async-storage";
const DBG_LOG_KEY = '@dbg6bcf75:log';
let _dbgQueue: Promise<void> = Promise.resolve();
const _dbg = (loc: string, msg: string, data?: Record<string, unknown>) => {
  const ts = Date.now();
  const entry = `${new Date(ts).toISOString().slice(11, 23)} [${loc}] ${msg} ${data ? JSON.stringify(data) : ''}`;
  console.log(`[DBG-6bcf75] ${entry}`);
  fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6bcf75' },
    body: JSON.stringify({ sessionId: '6bcf75', location: loc, message: msg, data, timestamp: ts }),
  }).catch(() => {});
  _dbgQueue = _dbgQueue.then(async () => {
    try {
      const prev = await AsyncStorage.getItem(DBG_LOG_KEY);
      const lines = prev ? prev.split('\n') : [];
      lines.push(entry);
      if (lines.length > 200) lines.splice(0, lines.length - 200);
      await AsyncStorage.setItem(DBG_LOG_KEY, lines.join('\n'));
    } catch {}
  });
};
// #endregion

WebBrowser.maybeCompleteAuthSession();

export default function WelcomeScreen() {
  const colors = useColors();
  const { startSSOFlow } = useSSO();
  const { isSignedIn } = useAuth();
  const clerk = useClerk();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // #region agent log
  const mountCount = useRef(0);
  useEffect(() => {
    mountCount.current++;
    _dbg('welcome:mount', 'WelcomeScreen mounted', {
      isSignedIn,
      mountNum: mountCount.current,
      hasClerkSession: !!clerk?.session,
      sessionId: clerk?.session?.id ?? null,
      sessionStatus: clerk?.session?.status ?? null,
      hasClerkUser: !!clerk?.user,
    });
    AsyncStorage.getItem('@autohaul:was_authenticated').then(wasAuth => {
      _dbg('welcome:diagnostic', 'mount with WAS_AUTH check', {
        wasAuthenticated: wasAuth,
        isSignedIn,
        hasClerkSession: !!clerk?.session,
        hasClerkUser: !!clerk?.user,
      });
      // Always pop on welcome mount during debug — bug-detection is "wasAuth=1".
      AsyncStorage.getItem(DBG_LOG_KEY).then(logs => {
        const allLines = (logs ?? '(no logs)').split('\n');
        const last30 = allLines.slice(-30).join('\n');
        const fullDump = `wasAuth=${wasAuth} clerk.session=${!!clerk?.session} clerk.user=${!!clerk?.user} isSignedIn=${isSignedIn}\n\n${logs ?? '(no logs)'}`;
        const titleSuffix = wasAuth === '1' ? '🚨 BUG' : 'fresh';
        Alert.alert(
          `Debug: Auth Log [${titleSuffix}]`,
          `wasAuth=${wasAuth}\nclerk.session=${!!clerk?.session} clerk.user=${!!clerk?.user} isSignedIn=${isSignedIn}\n\n--- LAST 30 OF ${allLines.length} LINES ---\n${last30}\n\nTap "Copy ALL" to copy the full ${allLines.length}-line log to clipboard, then paste in chat.`,
          [
            {
              text: 'Copy ALL',
              onPress: async () => {
                try {
                  await Clipboard.setStringAsync(fullDump);
                  Alert.alert('Copied', `${allLines.length} log lines copied to clipboard. Paste them in WhatsApp/chat now.`);
                } catch (e: any) {
                  Alert.alert('Copy failed', String(e?.message ?? e));
                }
              },
            },
            { text: 'OK' },
          ]
        );
      }).catch(() => {});
    }).catch(() => {});
  }, []);
  useEffect(() => {
    _dbg('welcome:isSignedIn', 'isSignedIn changed', {
      isSignedIn,
      hasClerkSession: !!clerk?.session,
      hasClerkUser: !!clerk?.user,
    });
  }, [isSignedIn, clerk?.session?.id, clerk?.user?.id]);
  // #endregion

  if (isSignedIn) {
    // #region agent log
    _dbg('welcome:redirect', 'REDIRECT BACK to /(tabs) — isSignedIn=true during render', { isSignedIn });
    // #endregion
    router.replace("/(tabs)");
    return null;
  }

  const [loadingProvider, setLoadingProvider] = useState<"google" | "apple" | null>(null);

  const handleSSOAuth = async (strategy: "oauth_google" | "oauth_apple") => {
    if (isLoading) return;
    setError("");
    setIsLoading(true);
    setLoadingProvider(strategy === "oauth_apple" ? "apple" : "google");

    // #region agent log
    _dbg('welcome:signInTap', 'Sign-In button tapped', {
      strategy,
      isSignedIn,
      hasClerkSession: !!clerk?.session,
      sessionId: clerk?.session?.id ?? null,
      sessionStatus: clerk?.session?.status ?? null,
      hasClerkUser: !!clerk?.user,
      userId: clerk?.user?.id ?? null,
      hasClerkObj: !!clerk,
    });
    // #endregion

    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const { createdSessionId, setActive } = await startSSOFlow({ strategy });

      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        while (router.canGoBack()) router.back();
        setTimeout(() => router.replace("/(tabs)"), 100);
      }
    } catch (err: any) {
      console.log(`[Welcome] ${strategy} auth error:`, err?.message);
      console.log(`[Welcome] ${strategy} auth errors:`, JSON.stringify(err?.errors, null, 2));
      const code = err?.errors?.[0]?.code ?? "";
      const msg0 = (err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? "").toLowerCase();
      // #region agent log
      _dbg('welcome:signInError', 'sign-in attempt errored', {
        strategy,
        code,
        msg: msg0,
        rawMessage: err?.message,
        errorCount: err?.errors?.length ?? 0,
        firstErrorCode: err?.errors?.[0]?.code,
        firstErrorMsg: err?.errors?.[0]?.message,
        isSignedInNow: isSignedIn,
        hasClerkSessionNow: !!clerk?.session,
        sessionIdNow: clerk?.session?.id ?? null,
      });
      // #endregion
      if (code === "session_exists" || msg0.includes("already signed in") || msg0.includes("session exists")) {
        // #region agent log
        _dbg('welcome:sessionExistsHit', 'SMOKING GUN: session_exists during sign-in', {
          isSignedInClient: isSignedIn,
          hasClerkSession: !!clerk?.session,
          clerkSessionId: clerk?.session?.id ?? null,
          clerkSessionStatus: clerk?.session?.status ?? null,
          hasClerkUser: !!clerk?.user,
          clerkUserId: clerk?.user?.id ?? null,
        });
        // #endregion
        await nukeAllClerkTokens().catch(() => {});
        setError("Session was stale. Please tap Sign In again.");
        return;
      }
      const clerkError = err?.errors?.[0];
      const msg =
        clerkError?.longMessage ??
        clerkError?.message ??
        err?.message ??
        "Sign-in failed. Please try again.";
      if (!msg.includes("cancel")) {
        setError(msg);
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const handleEmailAuth = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push("/(auth)/email-entry" as any);
  };

  return (
    <ScreenContainer containerClassName="bg-primary" safeAreaClassName="bg-primary">
      <View style={styles.hero}>
        <View style={[styles.logoWrap, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.logo}
            contentFit="contain"
          />
        </View>
        <Text style={styles.appName}>Puls Dispatch</Text>
        <Text style={styles.tagline}>Your loads. Your route. Your way.</Text>

        <View style={styles.features}>
          {[
            { icon: "📋", text: "View and manage assigned loads" },
            { icon: "📸", text: "Capture inspection photos on the go" },
            { icon: "🚗", text: "Track pickups and deliveries" },
          ].map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Get started</Text>
        <Text style={[styles.cardSub, { color: colors.muted }]}>
          Sign in to access your driver account.
        </Text>

        <TouchableOpacity
          style={[styles.googleBtn]}
          onPress={() => handleSSOAuth("oauth_google")}
          activeOpacity={0.85}
          disabled={isLoading}
        >
          {loadingProvider === "google" ? (
            <ActivityIndicator color="#333" />
          ) : (
            <View style={styles.googleBtnInner}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        {Platform.OS === "ios" && (
          <TouchableOpacity
            style={styles.appleBtn}
            onPress={() => handleSSOAuth("oauth_apple")}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            {loadingProvider === "apple" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.appleBtnInner}>
                <IconSymbol name="applelogo" size={18} color="#FFFFFF" />
                <Text style={styles.appleBtnText}>Continue with Apple</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={handleEmailAuth}
          activeOpacity={0.85}
          disabled={isLoading}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
            Continue with Email
          </Text>
        </TouchableOpacity>

        {!!error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingBottom: 20,
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logo: { width: 56, height: 56 },
  appName: {
    fontSize: 30,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 6,
  },
  tagline: {
    fontSize: 15,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 28,
  },
  features: { gap: 12 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureIcon: { fontSize: 20 },
  featureText: {
    fontSize: 15,
    color: "rgba(255,255,255,0.9)",
    fontWeight: "500",
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 40,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  cardSub: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  googleBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#dadce0",
  },
  googleBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  googleIcon: {
    fontSize: 20,
    fontWeight: "700",
    color: "#4285F4",
  },
  googleBtnText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
  },
  appleBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#000",
  },
  appleBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  appleBtnText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1.5,
  },
  secondaryBtnText: {
    fontSize: 17,
    fontWeight: "600",
  },
  error: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 12,
  },
});
