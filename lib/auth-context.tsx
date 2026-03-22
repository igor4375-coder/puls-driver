import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useUser, useAuth as useClerkAuth } from "@clerk/expo";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { registerForPushNotificationsAsync } from "@/lib/push-notifications";
import type { Driver } from "./data";

interface AuthContextType {
  driver: Driver | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PUSH_TOKEN_KEY = "autohaul_push_token_sent";
const WAS_AUTHENTICATED_KEY = "@autohaul:was_authenticated";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded: clerkLoaded, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();

  // Persisted flag: true once the user has ever authenticated on this device.
  // Prevents transient isSignedIn=false (token refresh) from triggering redirects.
  const [hadSession, setHadSession] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(WAS_AUTHENTICATED_KEY).then((v) => setHadSession(v === "1")).catch(() => setHadSession(false));
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
    if (!convexProfile || convexProfile.platformDriverCode || platformRegAttempted.current) return;
    if (!clerkUser?.id) return;
    platformRegAttempted.current = true;

    const name = convexProfile.name ?? "Driver";
    const phone = convexProfile.phone ?? "";

    registerDriverOnPlatform({ name, phone, driverCode: convexProfile.driverCode })
      .then((platformId) => {
        if (platformId && clerkUser?.id) {
          updateProfile({ clerkUserId: clerkUser.id, platformDriverCode: platformId });
          console.log("[Auth] Registered on company platform:", platformId);
        }
      })
      .catch((err) => {
        console.warn("[Auth] Platform registration failed (non-fatal):", err);
        platformRegAttempted.current = false;
      });
  }, [convexProfile, clerkUser?.id]);

  const driver: Driver | null = useMemo(() => {
    if (!isSignedIn || !clerkUser || !convexProfile) return null;

    const name =
      convexProfile.name ??
      clerkUser.fullName ??
      ([clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      "Driver");

    return {
      id: clerkUser.id,
      name,
      email: convexProfile.email ?? clerkUser.primaryEmailAddress?.emailAddress ?? "",
      phone: convexProfile.phone ?? clerkUser.primaryPhoneNumber?.phoneNumber ?? "",
      company: "",
      truckNumber: convexProfile.truckNumber ?? "",
      trailerNumber: convexProfile.trailerNumber ?? "",
      avatarInitials: name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2),
      driverCode: convexProfile.driverCode,
      platformDriverCode: convexProfile.platformDriverCode,
    };
  }, [isSignedIn, clerkUser, convexProfile]);

  useEffect(() => {
    if (!driver?.driverCode) return;
    refreshPushTokenIfNeeded(driver.driverCode, updateProfile, registerPlatformToken, clerkUser?.id ?? "");
  }, [driver?.driverCode]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active" && driver?.driverCode && clerkUser?.id) {
        refreshPushTokenIfNeeded(driver.driverCode, updateProfile, registerPlatformToken, clerkUser.id);
      }
    };
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [driver?.driverCode, clerkUser?.id]);

  const logout = async () => {
    setHadSession(false);
    AsyncStorage.removeItem(WAS_AUTHENTICATED_KEY).catch(() => {});
    try {
      await signOut();
    } catch (err) {
      console.warn("[Auth] Sign-out error:", err);
    }
    setProfileCreated(false);
  };

  // Stay in "loading" while Clerk hasn't loaded, OR while we know the user
  // had a previous session but Clerk hasn't confirmed sign-in yet (token hydration).
  const isLoading = !clerkLoaded || hadSession === null || (hadSession && !isSignedIn);

  return (
    <AuthContext.Provider
      value={{
        driver,
        isLoading,
        isAuthenticated: !!isSignedIn,
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
): Promise<void> {
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    // Save to driver app's own Convex
    await updateProfile({ clerkUserId, pushToken: token });
    // Also register with the company platform so dispatchers can send push notifications
    registerPlatformToken({ driverCode, pushToken: token }).catch(() => {});
  } catch {}
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const useAuthContext = useAuth;
