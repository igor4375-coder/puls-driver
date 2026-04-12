import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useUser, useAuth as useClerkAuth } from "@clerk/expo";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { registerForPushNotificationsAsync } from "@/lib/push-notifications";
import { nukeAllClerkTokens } from "@/lib/clerk-token-cache";
import type { Driver } from "./data";

// #region agent log
const _dbg = (loc: string, msg: string, data?: Record<string, unknown>) => { const p = { sessionId: '887738', location: loc, message: msg, data, timestamp: Date.now() }; console.log(`[DBG-887738] ${loc} | ${msg}`, data ?? ''); fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '887738' }, body: JSON.stringify(p) }).catch(() => {}); };
// #endregion

interface AuthContextType {
  driver: Driver | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PUSH_TOKEN_KEY = "autohaul_push_token_sent";
const WAS_AUTHENTICATED_KEY = "@autohaul:was_authenticated";
const CACHED_PROFILE_KEY = "@autohaul:cached_profile";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded: clerkLoaded, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();

  // Persisted flag: true once the user has ever authenticated on this device.
  // Prevents transient isSignedIn=false (token refresh) from triggering redirects.
  const [hadSession, setHadSession] = useState<boolean | null>(null);
  // Cached profile for offline fallback — populated from AsyncStorage on mount,
  // then kept in sync whenever Convex returns fresh data.
  const [cachedProfile, setCachedProfile] = useState<typeof convexProfile | null>(null);
  // Cache clerkUser.id in memory so driver stays alive during token refresh
  // (when isSignedIn is transiently false but hadSession is true).
  const [cachedClerkId, setCachedClerkId] = useState<string | null>(null);

  // Circuit-breaker: if Clerk can't confirm sign-in within 5 s of loading,
  // treat the session as expired so the driver reaches the sign-in screen
  // instead of being stuck in a permanent loading state.
  const [sessionExpired, setSessionExpired] = useState(false);
  const hydrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // #region agent log
    _dbg('auth-context:circuitBreaker', 'effect fired', { clerkLoaded, hadSession, isSignedIn, sessionExpired });
    // #endregion
    if (clerkLoaded && hadSession === true && !isSignedIn) {
      // #region agent log
      _dbg('auth-context:circuitBreaker', 'STARTING 5s timer — isSignedIn=false with hadSession', { clerkLoaded, hadSession, isSignedIn });
      // #endregion
      hydrationTimer.current = setTimeout(() => {
        console.warn("[Auth] Session hydration timed out — treating as expired");
        // #region agent log
        _dbg('auth-context:circuitBreaker', 'TIMER FIRED — sessionExpired=true', { clerkLoaded, hadSession, isSignedIn });
        // #endregion
        setSessionExpired(true);
      }, 5_000);
    } else {
      if (hydrationTimer.current) {
        clearTimeout(hydrationTimer.current);
        hydrationTimer.current = null;
        // #region agent log
        _dbg('auth-context:circuitBreaker', 'Timer CLEARED', { clerkLoaded, hadSession, isSignedIn });
        // #endregion
      }
      if (isSignedIn) setSessionExpired(false);
    }
    return () => {
      if (hydrationTimer.current) clearTimeout(hydrationTimer.current);
    };
  }, [clerkLoaded, hadSession, isSignedIn]);

  useEffect(() => {
    AsyncStorage.getItem(WAS_AUTHENTICATED_KEY).then((v) => {
      setHadSession(v === "1");
    }).catch(() => setHadSession(false));
    // Load cached profile for offline use
    AsyncStorage.getItem(CACHED_PROFILE_KEY).then((v) => {
      if (v) setCachedProfile(JSON.parse(v));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isSignedIn && hadSession !== true) {
      setHadSession(true);
      AsyncStorage.setItem(WAS_AUTHENTICATED_KEY, "1").catch(() => {});
    }
  }, [isSignedIn, hadSession]);

  const getOrCreateProfile = useMutation(api.driverProfiles.getOrCreateProfile);
  const updateProfile = useMutation(api.driverProfiles.updateProfile);
  const registerPlatformToken = useAction(api.platform.registerPushToken);
  const registerDriverOnPlatform = useAction(api.platform.registerDriver);
  const convexProfile = useQuery(
    api.driverProfiles.getByClerkUserId,
    clerkUser?.id ? { clerkUserId: clerkUser.id } : "skip",
  );

  // Keep AsyncStorage cache in sync whenever we get a fresh profile from Convex
  useEffect(() => {
    if (convexProfile) {
      setCachedProfile(convexProfile);
      AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(convexProfile)).catch(() => {});
    }
  }, [convexProfile]);

  // Cache clerkUser.id in memory so it survives token refresh gaps
  useEffect(() => {
    if (clerkUser?.id) setCachedClerkId(clerkUser.id);
  }, [clerkUser?.id]);

  // Use live Convex data when available, fall back to cached profile when offline
  const activeProfile = convexProfile ?? cachedProfile ?? undefined;
  // During token refresh (isSignedIn transiently false), keep using cached IDs
  const effectiveClerkId = clerkUser?.id ?? (hadSession ? cachedClerkId : null);
  const effectiveSignedIn = isSignedIn || (hadSession === true && !!effectiveClerkId && !!activeProfile);

  const [profileCreated, setProfileCreated] = useState(false);

  useEffect(() => {
    if (!isSignedIn || !clerkUser?.id || profileCreated) return;

    const phone = clerkUser.primaryPhoneNumber?.phoneNumber ?? undefined;
    const email = clerkUser.primaryEmailAddress?.emailAddress ?? undefined;
    const name =
      clerkUser.fullName ??
      ([clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      "Driver");

    getOrCreateProfile({
      clerkUserId: clerkUser.id,
      name,
      phone,
      email,
    }).then(() => {
      setProfileCreated(true);
    }).catch((err) => {
      console.warn("[Auth] Failed to create/get profile in Convex:", err);
    });
  }, [isSignedIn, clerkUser?.id, profileCreated, getOrCreateProfile]);

  // Register driver on the company platform if not yet registered.
  // This gives the driver a platformDriverCode that dispatchers can use to invite them.
  const platformRegAttempted = React.useRef(false);
  useEffect(() => {
    if (!activeProfile || activeProfile.platformDriverCode || platformRegAttempted.current) return;
    if (!clerkUser?.id) return;
    platformRegAttempted.current = true;

    const name = activeProfile.name ?? "Driver";
    const phone = activeProfile.phone ?? "";
    const email = activeProfile.email
      ?? clerkUser.primaryEmailAddress?.emailAddress
      ?? "";

    console.log("[Auth] Registering driver on company platform:", { name, phone, email, driverCode: activeProfile.driverCode });

    registerDriverOnPlatform({ name, phone, email, driverCode: activeProfile.driverCode })
      .then((platformId) => {
        if (platformId && clerkUser?.id) {
          updateProfile({ clerkUserId: clerkUser.id, platformDriverCode: platformId });
          console.log("[Auth] Registered on company platform:", platformId);
        } else {
          console.warn("[Auth] Platform registration returned null — will retry on next mount");
          platformRegAttempted.current = false;
        }
      })
      .catch((err) => {
        console.warn("[Auth] Platform registration failed (will retry):", err);
        platformRegAttempted.current = false;
      });
  }, [activeProfile, clerkUser?.id]);

  const driver: Driver | null = useMemo(() => {
    if (!effectiveSignedIn || !effectiveClerkId || !activeProfile) return null;

    const name =
      activeProfile.name ??
      clerkUser?.fullName ??
      ([clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
      "Driver");

    return {
      id: effectiveClerkId,
      name,
      email: activeProfile.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? "",
      phone: activeProfile.phone ?? clerkUser?.primaryPhoneNumber?.phoneNumber ?? "",
      company: "",
      truckNumber: activeProfile.truckNumber ?? "",
      trailerNumber: activeProfile.trailerNumber ?? "",
      avatarInitials: name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2),
      driverCode: activeProfile.driverCode,
      platformDriverCode: activeProfile.platformDriverCode,
    };
  }, [effectiveSignedIn, effectiveClerkId, clerkUser, activeProfile]);

  const pushSyncOpts = useMemo(() => ({
    platformDriverCode: driver?.platformDriverCode ?? undefined,
    name: driver?.name,
    phone: driver?.phone,
  }), [driver?.platformDriverCode, driver?.name, driver?.phone]);

  useEffect(() => {
    if (!driver?.driverCode) return;
    refreshPushTokenIfNeeded(driver.driverCode, updateProfile, registerPlatformToken, clerkUser?.id ?? "", pushSyncOpts);
  }, [driver?.driverCode]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active" && driver?.driverCode && clerkUser?.id) {
        refreshPushTokenIfNeeded(driver.driverCode, updateProfile, registerPlatformToken, clerkUser.id, pushSyncOpts);
      }
    };
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [driver?.driverCode, clerkUser?.id, pushSyncOpts]);

  const logout = async () => {
    setHadSession(false);
    setCachedProfile(null);
    setCachedClerkId(null);
    AsyncStorage.removeItem(WAS_AUTHENTICATED_KEY).catch(() => {});
    AsyncStorage.removeItem(CACHED_PROFILE_KEY).catch(() => {});
    try {
      await signOut();
    } catch (err) {
      console.warn("[Auth] Sign-out error:", err);
    }
    // Force-clear all Clerk tokens from SecureStore so no stale
    // keychain session survives (especially after background resume).
    await nukeAllClerkTokens().catch(() => {});
    setProfileCreated(false);
  };

  // Stay in "loading" while Clerk hasn't loaded, OR while we know the user
  // had a previous session but Clerk hasn't confirmed sign-in yet (token
  // hydration). The sessionExpired flag breaks the deadlock after 5 s so the
  // driver can reach the sign-in screen instead of waiting forever.
  const isLoading =
    !clerkLoaded ||
    hadSession === null ||
    (hadSession === true && !isSignedIn && !sessionExpired);

  const computedIsAuthenticated = sessionExpired ? !!isSignedIn : effectiveSignedIn;

  // #region agent log
  useEffect(() => {
    _dbg('auth-context:state', 'auth state changed', { isLoading, isAuthenticated: computedIsAuthenticated, sessionExpired, isSignedIn, hadSession, clerkLoaded, effectiveSignedIn, hasDriver: !!driver, hasActiveProfile: !!activeProfile, hasCachedClerkId: !!cachedClerkId });
  }, [isLoading, computedIsAuthenticated, sessionExpired, isSignedIn, hadSession, clerkLoaded]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      _dbg('auth-context:appState', 'AppState changed', { newState: state, isSignedIn, clerkLoaded, hadSession, sessionExpired, isLoading, isAuthenticated: computedIsAuthenticated });
    });
    return () => sub.remove();
  }, [isSignedIn, clerkLoaded, hadSession, sessionExpired, isLoading, computedIsAuthenticated]);
  // #endregion

  return (
    <AuthContext.Provider
      value={{
        driver,
        isLoading,
        isAuthenticated: computedIsAuthenticated,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function refreshPushTokenIfNeeded(
  driverCode: string,
  updateProfile: (args: { clerkUserId: string; pushToken?: string }) => Promise<unknown>,
  registerPlatformToken: (args: { driverCode: string; pushToken: string }) => Promise<unknown>,
  clerkUserId: string,
  opts?: { platformDriverCode?: string; name?: string; phone?: string },
): Promise<void> {
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    await updateProfile({ clerkUserId, pushToken: token });
    registerPlatformToken({ driverCode, pushToken: token }).catch(() => {});
    syncPushTokenToRailway(driverCode, token, opts).catch(() => {});
  } catch {}
}

async function syncPushTokenToRailway(
  driverCode: string,
  pushToken: string,
  opts?: { platformDriverCode?: string; name?: string; phone?: string },
) {
  const { getApiBaseUrl } = await import("@/constants/oauth");
  const url = `${getApiBaseUrl()}/api/trpc/push.syncToken`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { driverCode, pushToken, ...opts } }),
  });
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const useAuthContext = useAuth;
