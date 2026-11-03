import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useSSO, useAuth } from "@clerk/expo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { nukeAllClerkTokens } from "@/lib/clerk-token-cache";
import { resetTo } from "@/lib/navigation";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";

WebBrowser.maybeCompleteAuthSession();

const FEATURES = [
  { icon: "📋", text: "View and manage assigned loads" },
  { icon: "📸", text: "Capture inspection photos on the go" },
  { icon: "🚗", text: "Track pickups and deliveries" },
] as const;

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Galaxy S10-class screens (~720–780 after chrome) need a compact layout so
  // the title/banner and sign-in buttons don't collide.
  const compact = height < 780;
  const { startSSOFlow } = useSSO();
  const { isSignedIn } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  // Must stay above the isSignedIn return. Declared below it, this hook stopped
  // running the moment a sign-in completed, so React saw fewer hooks than the
  // previous render and killed the app — a launch-and-die loop for anyone whose
  // session resolved while this screen was still mounted.
  const [loadingProvider, setLoadingProvider] = useState<"google" | "apple" | null>(null);

  // Navigating during render is not allowed either; it has to be an effect.
  useEffect(() => {
    if (isSignedIn) router.replace("/(tabs)");
  }, [isSignedIn]);

  if (isSignedIn) {
    return null;
  }

  const handleSSOAuth = async (strategy: "oauth_google" | "oauth_apple") => {
    if (isLoading) return;
    setError("");
    setIsLoading(true);
    setLoadingProvider(strategy === "oauth_apple" ? "apple" : "google");

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
        resetTo("/(tabs)");
      }
    } catch (err: any) {
      const code = err?.errors?.[0]?.code ?? "";
      const msg0 = (err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? "").toLowerCase();
      if (code === "session_exists" || msg0.includes("already signed in") || msg0.includes("session exists")) {
        // Defensive recovery: if Clerk thinks a session already exists,
        // wipe local tokens so the next tap creates a fresh session.
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
    <ScreenContainer
      edges={["top", "left", "right"]}
      containerClassName="bg-primary"
      safeAreaClassName="bg-primary"
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          // Room for the absolute version banner above the logo.
          compact && { paddingTop: 40 },
        ]}
        bounces={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, compact && styles.heroCompact]}>
          <View
            style={[
              styles.logoWrap,
              compact && styles.logoWrapCompact,
              { backgroundColor: "rgba(255,255,255,0.15)" },
            ]}
          >
            <Image
              source={require("@/assets/images/icon.png")}
              style={[styles.logo, compact && styles.logoCompact]}
              contentFit="contain"
            />
          </View>
          <Text style={[styles.appName, compact && styles.appNameCompact]} numberOfLines={1}>
            Puls Dispatch
          </Text>
          <Text style={[styles.tagline, compact && styles.taglineCompact]}>
            Your loads. Your route. Your way.
          </Text>

          {!compact && (
            <View style={styles.features}>
              {FEATURES.map((f) => (
                <View key={f.text} style={styles.featureRow}>
                  <Text style={styles.featureIcon}>{f.icon}</Text>
                  <Text style={styles.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View
          style={[
            styles.card,
            compact && styles.cardCompact,
            compact && { paddingBottom: Math.max(insets.bottom, 8) + 16 },
            { backgroundColor: colors.surface },
          ]}
        >
          <Text style={[styles.cardTitle, compact && styles.cardTitleCompact, { color: colors.foreground }]}>
            Get started
          </Text>
          <Text style={[styles.cardSub, compact && styles.cardSubCompact, { color: colors.muted }]}>
            Sign in to access your driver account.
          </Text>

          <TouchableOpacity
            style={[styles.googleBtn, compact && styles.btnCompact]}
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
              style={[styles.appleBtn, compact && styles.btnCompact]}
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
            style={[styles.secondaryBtn, compact && styles.btnCompact, { borderColor: colors.border }]}
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
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
  },
  hero: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingBottom: 20,
    flexGrow: 1,
  },
  heroCompact: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    flexGrow: 0,
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoWrapCompact: {
    width: 64,
    height: 64,
    borderRadius: 18,
    marginBottom: 10,
  },
  logo: { width: 56, height: 56 },
  logoCompact: { width: 40, height: 40 },
  appName: {
    fontSize: 30,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 6,
  },
  appNameCompact: {
    fontSize: 24,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 15,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 28,
    textAlign: "center",
  },
  taglineCompact: {
    fontSize: 13,
    marginBottom: 8,
  },
  features: { gap: 12, alignSelf: "stretch" },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureIcon: { fontSize: 20 },
  featureText: {
    flex: 1,
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
  cardCompact: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  cardTitleCompact: {
    fontSize: 18,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  cardSubCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  btnCompact: {
    paddingVertical: 13,
    marginBottom: 10,
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
