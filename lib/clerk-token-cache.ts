import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const _trackedKeys = new Set<string>();

// Apple's keychain default (`WHEN_UNLOCKED`) makes items inaccessible while
// the device is locked. Clerk auto-refreshes its JWT every ~50s, and the
// app's UIBackgroundModes ("location", "fetch") let iOS wake the JS in
// background — at which point Clerk reads the token, SecureStore returns
// null/throws because the keychain is locked, and Clerk treats it as
// "no session" and nulls clerk.session in memory. Force-quit + reopen
// recovers because cold start happens after the user unlocks the device.
//
// AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY keeps tokens accessible even while
// the device is locked (after first unlock since boot) and is Apple's
// recommended setting for auth tokens. _THIS_DEVICE_ONLY also prevents
// iCloud Keychain sync (security best practice for session secrets).
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// Tracks which keys we've already migrated this session so we don't re-write
// on every getToken call — only the FIRST successful read upgrades storage.
const _migratedKeys = new Set<string>();

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
      const v = await SecureStore.getItemAsync(key);
      // Auto-migrate: if we successfully read a token (which means the
      // device is currently unlocked enough to access it), rewrite it under
      // AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY so subsequent background reads
      // succeed even while the device is locked. Old tokens stored before
      // this fix were under WHEN_UNLOCKED; this upgrades them in place.
      if (v !== null && !_migratedKeys.has(key)) {
        _migratedKeys.add(key);
        try {
          await SecureStore.deleteItemAsync(key);
          await SecureStore.setItemAsync(key, v, SECURE_OPTS);
        } catch {
          // Migration failure is non-fatal; the token is still readable
          // under its old policy while the device is unlocked.
        }
      }
      return v;
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    _trackedKeys.add(key);
    _migratedKeys.add(key);
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(key, value);
      } catch {}
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value, SECURE_OPTS);
    } catch {}
  },
  async clearToken(key: string): Promise<void> {
    _trackedKeys.delete(key);
    _migratedKeys.delete(key);
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
  _migratedKeys.clear();
}
