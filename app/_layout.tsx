import "@/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { AppState, Platform } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { ClerkProvider, ClerkLoaded } from "@clerk/expo";
import { tokenCache } from "@/lib/clerk-token-cache";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient, useConvex } from "convex/react";
import { useAuth as useClerkAuth } from "@clerk/expo";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTRPCClient } from "@/lib/trpc";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SettingsProvider } from "@/lib/settings-context";
import { LoadsProvider } from "@/lib/loads-context";
import { PermissionsProvider } from "@/lib/permissions-context";
import { SyncStatusBanner } from "@/components/sync-status-banner";
import { UpdateVersionBanner } from "@/components/update-version-banner";
import { ErrorBoundary } from "@/components/error-boundary";
import { setupNotificationResponseListener } from "@/lib/push-notifications";
import { photoQueue } from "@/lib/photo-queue";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { startLocationTracking, stopLocationTracking, flushLocationQueue } from "@/lib/location-tracker";
import { useSettings } from "@/lib/settings-context";
import { getApiBaseUrl } from "@/constants/oauth";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

export const unstable_settings = {
  anchor: "(tabs)",
};

function LocationTrackingManager() {
  const { driver } = useAuth();
  const { settings } = useSettings();
  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? null;

  useEffect(() => {
    if (Platform.OS === "web") return;

    if (driverCode && settings.locationTrackingEnabled) {
      startLocationTracking(driverCode, getApiBaseUrl).catch((err) =>
        console.warn("[LocationTracker] start failed:", err),
      );
    } else {
      stopLocationTracking();
    }

    return () => {
      stopLocationTracking();
    };
  }, [driverCode, settings.locationTrackingEnabled]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") flushLocationQueue().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return null;
}

function LoadsProviderWithAuth({ children }: { children: React.ReactNode }) {
  const { driver } = useAuth();
  const driverCode = driver?.platformDriverCode ?? driver?.driverCode ?? null;
  return (
    <PermissionsProvider driverCode={driverCode}>
      <LoadsProvider driverCode={driverCode}>
        <LocationTrackingManager />
        {children}
      </LoadsProvider>
    </PermissionsProvider>
  );
}

function AppContent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  useEffect(() => {
    initManusRuntime();
  }, []);

  useEffect(() => {
    const cleanup = setupNotificationResponseListener();
    return cleanup;
  }, []);

  useEffect(() => {
    photoQueue.startBackgroundRetry();
    return () => photoQueue.stopBackgroundRetry();
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SettingsProvider>
            <LoadsProviderWithAuth>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="load/[id]" />
            <Stack.Screen name="inspection/[loadId]/[vehicleId]" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="inspection/[loadId]/additional/[vehicleId]" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="bol/[loadId]" options={{ presentation: "modal" }} />
            <Stack.Screen name="vin-scanner" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="add-load" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="camera-session" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
            <Stack.Screen name="alternate-delivery/[loadId]" options={{ presentation: "modal" }} />
            <Stack.Screen name="field-pickup-report" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="oauth/callback" />
          </Stack>
          <SyncStatusBanner />
          <UpdateVersionBanner />
          <StatusBar style="auto" />
            </LoadsProviderWithAuth>
          </SettingsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const shouldOverrideSafeArea = Platform.OS === "web";

  const safeAreaContent = (safeChildren: React.ReactNode) => {
    if (shouldOverrideSafeArea) {
      return (
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {safeChildren}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      );
    }
    return (
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>
        {safeChildren}
      </SafeAreaProvider>
    );
  };

  const appContent = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );

  if (!CLERK_PUBLISHABLE_KEY) {
    // Fallback: run without Clerk (for development without keys)
    return (
      <ThemeProvider>
        {safeAreaContent(appContent)}
      </ThemeProvider>
    );
  }

  const wrappedContent = convex ? (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        <ConvexProviderWithClerk client={convex} useAuth={useClerkAuth}>
          {appContent}
        </ConvexProviderWithClerk>
      </ClerkLoaded>
    </ClerkProvider>
  ) : (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        {appContent}
      </ClerkLoaded>
    </ClerkProvider>
  );

  return (
    <ThemeProvider>
      {safeAreaContent(wrappedContent)}
    </ThemeProvider>
  );
}
