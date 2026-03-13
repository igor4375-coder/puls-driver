import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "./auth";
import { router } from "expo-router";

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

const MAX_RETRIES = 2;
const RETRY_DELAYS = [500, 1500];

let _handlingUnauth = false;

async function handleUnauthorized() {
  if (_handlingUnauth) return;
  _handlingUnauth = true;
  try {
    console.warn("[API] 401 — clearing session and redirecting to login");
    await Auth.removeSessionToken();
    await Auth.clearUserInfo();
    router.replace("/(auth)/welcome" as any);
  } finally {
    setTimeout(() => { _handlingUnauth = false; }, 3000);
  }
}

async function doFetch<T>(url: string, options: RequestInit, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, { ...options, headers, credentials: "include" });

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error("Session expired — please log in again");
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[API] Error response:", errorText);
    let errorMessage = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorJson.message || errorText;
    } catch {}
    throw new Error(errorMessage || `API call failed: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (Platform.OS !== "web") {
    const sessionToken = await Auth.getSessionToken();
    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
    }
  }

  const baseUrl = getApiBaseUrl();
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await doFetch<T>(url, options, headers);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      // Don't retry auth errors or non-idempotent requests
      const isAuthError = lastError.message.includes("Session expired");
      const isWrite = (options.method ?? "GET").toUpperCase() !== "GET";
      if (isAuthError || isWrite || attempt === MAX_RETRIES) throw lastError;
      const delay = RETRY_DELAYS[attempt] ?? 1500;
      console.warn(`[API] Retry ${attempt + 1}/${MAX_RETRIES} for ${endpoint} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error("Request failed");
}

// OAuth callback handler - exchange code for session token
// Calls /api/oauth/mobile endpoint which returns JSON with app_session_id and user
export async function exchangeOAuthCode(
  code: string,
  state: string,
): Promise<{ sessionToken: string; user: any }> {
  console.log("[API] exchangeOAuthCode called");
  // Use GET with query params
  const params = new URLSearchParams({ code, state });
  const endpoint = `/api/oauth/mobile?${params.toString()}`;
  console.log("[API] Calling OAuth mobile endpoint:", endpoint);
  const result = await apiCall<{ app_session_id: string; user: any }>(endpoint);

  // Convert app_session_id to sessionToken for compatibility
  const sessionToken = result.app_session_id;
  console.log("[API] OAuth exchange result:", {
    hasSessionToken: !!sessionToken,
    hasUser: !!result.user,
    sessionToken: sessionToken ? `${sessionToken.substring(0, 50)}...` : null,
  });

  return {
    sessionToken,
    user: result.user,
  };
}

// Logout
export async function logout(): Promise<void> {
  await apiCall<void>("/api/auth/logout", {
    method: "POST",
  });
}

// Get current authenticated user (web uses cookie-based auth)
export async function getMe(): Promise<{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
} | null> {
  try {
    const result = await apiCall<{ user: any }>("/api/auth/me");
    return result.user || null;
  } catch (error) {
    console.error("[API] getMe failed:", error);
    return null;
  }
}

// Establish session cookie on the backend (3000-xxx domain)
// Called after receiving token via postMessage to get a proper Set-Cookie from the backend
export async function establishSession(token: string): Promise<boolean> {
  try {
    console.log("[API] establishSession: setting cookie on backend...");
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/auth/session`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include", // Important: allows Set-Cookie to be stored
    });

    if (!response.ok) {
      console.error("[API] establishSession failed:", response.status);
      return false;
    }

    console.log("[API] establishSession: cookie set successfully");
    return true;
  } catch (error) {
    console.error("[API] establishSession error:", error);
    return false;
  }
}
