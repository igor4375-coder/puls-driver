/**
 * Legacy login screen — redirects to phone entry.
 * Email/password login has been replaced by phone-based OTP authentication.
 */
import { useEffect } from "react";
import { router } from "expo-router";

export default function LoginScreen() {
  useEffect(() => {
    // Redirect to phone entry — email/password login is no longer supported
    router.replace("/(auth)/welcome" as any);
  }, []);

  return null;
}
