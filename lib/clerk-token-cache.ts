import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const _trackedKeys = new Set<string>();

// #region agent log
const DBG_LOG_KEY = '@dbg6bcf75:log';
let _dbgQueue: Promise<void> = Promise.resolve();
const _dbg = (loc: string, msg: string, data?: Record<string, unknown>) => {
  const ts = Date.now();
  const entry = `${new Date(ts).toISOString().slice(11, 23)} [${loc}] ${msg} ${data ? JSON.stringify(data) : ''}`;
  console.log(`[DBG-6bcf75] ${entry}`);
  fetch('http://127.0.0.1:7527/ingest/340f175d-2206-41c1-9235-1bc70ac26ba5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6bcf75' },
    body: JSON.stringify({ sessionId: '6bcf75', location: loc, message: msg, data, timestamp: ts }),
  }).catch(() => {});
  _dbgQueue = _dbgQueue.then(async () => {
    try {
      const prev = await AsyncStorage.getItem(DBG_LOG_KEY);
      const lines = prev ? prev.split('\n') : [];
      lines.push(entry);
      if (lines.length > 200) lines.splice(0, lines.length - 200);
      await AsyncStorage.setItem(DBG_LOG_KEY, lines.join('\n'));
    } catch {}
  });
};
// #endregion

// CRITICAL: Apple's keychain default (`WHEN_UNLOCKED`) makes items inaccessible
// while the device is locked. Clerk auto-refreshes its JWT every ~50s, and the
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
      // #region agent log
      _dbg('tokenCache:get', 'SecureStore.getItem', { key, hasValue: v !== null && v !== undefined });
      // #endregion
      // Auto-migrate: if we successfully read a token (which means the
      // device is currently unlocked enough to access it), rewrite it under
      // AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY so subsequent background reads
      // succeed even while the device is locked. Old tokens stored before
      // this fix are under WHEN_UNLOCKED; this upgrades them in place.
      if (v !== null && !_migratedKeys.has(key)) {
        _migratedKeys.add(key);
        try {
          await SecureStore.deleteItemAsync(key);
          await SecureStore.setItemAsync(key, v, SECURE_OPTS);
          // #region agent log
          _dbg('tokenCache:migrate', 'rewrote token under AFTER_FIRST_UNLOCK', { key });
          // #endregion
        } catch (err: any) {
          // #region agent log
          _dbg('tokenCache:migrate', 'migration FAILED', { key, err: String(err?.message ?? err) });
          // #endregion
        }
      }
      return v;
    } catch (err: any) {
      // #region agent log
      _dbg('tokenCache:get', 'SecureStore.getItem THREW (likely keychain locked)', { key, err: String(err?.message ?? err) });
      // #endregion
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    _trackedKeys.add(key);
    _migratedKeys.add(key); // already saved with new opts
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(key, value);
      } catch {}
      return;
    }
    try {
      await SecureStore.setItemAsync(key, value, SECURE_OPTS);
      // #region agent log
      _dbg('tokenCache:save', 'SecureStore.setItem', { key, accessibility: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' });
      // #endregion
    } catch (err: any) {
      // #region agent log
      _dbg('tokenCache:save', 'SecureStore.setItem FAILED', { key, err: String(err?.message ?? err) });
      // #endregion
    }
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
