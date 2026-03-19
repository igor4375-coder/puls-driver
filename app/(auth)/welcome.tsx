import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useSSO, useAuth } from "@clerk/expo";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

WebBrowser.maybeCompleteAuthSession();

export default function WelcomeScreen() {
  const colors = useColors();
  const { startSSOFlow } = useSSO();
  const { isSignedIn } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  if (isSignedIn) {
    router.replace("/(tabs)");
    return null;
  }

  const handleGoogleAuth = async () => {
    if (isLoading) return;
    setError("");
    setIsLoading(true);

    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const { createdSessionId, setActive, signIn, signUp } = await startSSOFlow({
        strategy: "oauth_google",
      });

      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        while (router.canGoBack()) router.back();
        setTimeout(() => router.replace("/(tabs)"), 100);
      }
    } catch (err: any) {
      console.log("[Welcome] Google auth error:", err?.message);
      console.log("[Welcome] Google auth errors:", JSON.stringify(err?.errors, null, 2));
      const clerkError = err?.errors?.[0];
      const msg =
        clerkError?.longMessage ??
        clerkError?.message ??
        err?.message ??
        "Google sign-in failed. Please try again.";
      if (!msg.includes("cancel")) {
        setError(msg);
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsLoading(false);
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
          onPress={handleGoogleAuth}
          activeOpacity={0.85}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#333" />
          ) : (
            <View style={styles.googleBtnInner}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={handleEmailAuth}
          activeOpacity={0.85}
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
