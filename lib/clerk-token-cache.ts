import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const _trackedKeys = new Set<string>();

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    _trackedKeys.add(key);
    if (Platform.OS === "web") {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    _trackedKeys.add(key);
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(key, value);
      } catch {}
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {}
  },
  async clearToken(key: string): Promise<void> {
    _trackedKeys.delete(key);
    if (Platform.OS === "web") {
      try {
        localStorage.removeItem(key);
      } catch {}
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
  },
};

/**
 * Force-clear ALL tokens Clerk has ever stored via the cache.
 * Ensures no stale keychain sessions survive a broken signOut().
 */
export async function nukeAllClerkTokens(): Promise<void> {
  const keys = [..._trackedKeys];
  for (const key of keys) {
    await tokenCache.clearToken(key);
  }
  _trackedKeys.clear();
}
