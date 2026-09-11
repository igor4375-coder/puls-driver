import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Updates from "expo-updates";
import { useAuth } from "@clerk/expo";

import { addBreadcrumb } from "@/lib/crash-reporter";
import { resetClerkStorage } from "@/lib/clerk-token-cache";

/**
 * Clerk's own <ClerkLoaded> renders `null` until initialization finishes, and
 * initialization needs a round trip to Clerk's API. On a device that cannot
 * complete that call — no connectivity, a wedged keychain entry, a rejected
 * session — the app is a permanently black screen with no message and no way
 * out, which is indistinguishable from a crash to the driver holding it.
 *
 * This gate keeps the same blocking behaviour but makes it visible, bounded,
 * and recoverable.
 */
const STUCK_AFTER_MS = 12_000;

export function StartupGate({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useAuth();
  const [isStuck, setIsStuck] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (isLoaded) {
      addBreadcrumb("clerk ready");
      return;
    }
    addBreadcrumb("clerk init");
    const timer = setTimeout(() => {
      addBreadcrumb("clerk init stalled");
      setIsStuck(true);
    }, STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  if (isLoaded) return <>{children}</>;

  const handleRetry = () => {
    addBreadcrumb("startup retry");
    Updates.reloadAsync().catch(() => setIsStuck(true));
  };

  const handleReset = () => {
    setIsResetting(true);
    addBreadcrumb("startup reset");
    resetClerkStorage()
      .catch(() => {})
      .then(() => Updates.reloadAsync())
      .catch(() => setIsResetting(false));
  };

  return (
    <View style={styles.container}>
      {!isStuck ? (
        <>
          <ActivityIndicator size="large" color="#0a7ea4" />
          <Text style={styles.message}>Starting up…</Text>
        </>
      ) : (
        <>
          <Text style={styles.emoji}>📡</Text>
          <Text style={styles.title}>Can&apos;t finish signing in</Text>
          <Text style={styles.message}>
            The app can&apos;t reach the sign-in service. Check your connection and try again.
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleRetry} disabled={isResetting}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={handleReset} disabled={isResetting}>
            <Text style={styles.secondaryText}>
              {isResetting ? "Resetting…" : "Reset sign-in and start over"}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#FFFFFF",
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "700", color: "#1a1a1a", marginBottom: 8 },
  message: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    backgroundColor: "#0a7ea4",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  secondary: { marginTop: 16, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryText: { color: "#0a7ea4", fontSize: 14, fontWeight: "600" },
});
