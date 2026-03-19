import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { AppState, type AppStateStatus } from "react-native";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded: clerkLoaded, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();

  const getOrCreateProfile = useMutation(api.driverProfiles.getOrCreateProfile);
  const updateProfile = useMutation(api.driverProfiles.updateProfile);
  const registerPlatformToken = useAction(api.platform.registerPushToken);
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
    try {
      await signOut();
    } catch (err) {
      console.warn("[Auth] Sign-out error:", err);
    }
    setProfileCreated(false);
  };

  const isLoading = !clerkLoaded;

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
