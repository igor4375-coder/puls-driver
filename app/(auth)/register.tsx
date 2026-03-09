/**
 * Legacy register screen — redirects to phone entry.
 * Account creation now happens through phone-based OTP authentication.
 * New users who verify their phone number are automatically registered.
 */
import { useEffect } from "react";
import { router } from "expo-router";

export default function RegisterScreen() {
  useEffect(() => {
    // Redirect to phone entry — registration is now handled via phone OTP
    router.replace("/(auth)/welcome" as any);
  }, []);

  return null;
}
