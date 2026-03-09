/**
 * Phone Authentication Service — Option B (Device-Binding, No SMS Cost)
 *
 * This file is the SINGLE POINT OF CHANGE when upgrading to Option A (Twilio OTP).
 *
 * UPGRADE PATH TO OPTION A (Twilio OTP):
 *   1. Install: pnpm add twilio
 *   2. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID to secrets
 *   3. Replace `sendVerification` to call Twilio Verify API (send SMS)
 *   4. Replace `checkVerification` to call Twilio Verify check API (verify OTP)
 *   5. The tRPC router (routers.ts phoneAuth.*) and all frontend screens stay identical.
 *
 * Current implementation (Option B):
 *   - No SMS is sent. The phone number is stored with a device fingerprint.
 *   - If the same phone number is used again from any device, the existing
 *     driver profile is returned (one permanent ID per phone number).
 *   - A 6-digit "verification code" is generated server-side and returned
 *     directly in the API response (no SMS). The frontend shows it to the user
 *     for confirmation — this acts as a simple "you entered your number correctly"
 *     check rather than true SMS ownership verification.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { phoneAuthSessions } from "../drizzle/schema";

export interface PhoneVerificationResult {
  /** Whether the phone number already has an existing driver profile */
  isExistingUser: boolean;
  /** The 6-digit code to confirm (returned directly in Option B; sent via SMS in Option A) */
  code: string;
  /** Expiry timestamp (ms since epoch) */
  expiresAt: number;
}

export interface PhoneConfirmResult {
  /** Whether the code was valid */
  success: boolean;
  /** Whether this phone number already had a driver profile */
  isExistingUser: boolean;
  /** The normalized phone number */
  phoneNumber: string;
}

// In-memory OTP store for Option B (no DB needed for the code itself)
// Key: normalized phone number, Value: { code, expiresAt }
const otpStore = new Map<string, { code: string; expiresAt: number }>();

/**
 * Normalize a phone number to E.164 format.
 * Strips all non-digit characters except leading +.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  // If it starts with +, keep it; otherwise assume North American (+1)
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Step 1: Initiate phone verification.
 *
 * Option B: Generates a 6-digit code, stores it in memory, and returns it
 * directly (no SMS). The frontend displays it for the user to confirm.
 *
 * Option A replacement: Call Twilio Verify API to send an SMS, return
 * { isExistingUser, code: "", expiresAt } (code is sent via SMS, not returned).
 */
export async function sendVerification(phoneNumber: string): Promise<PhoneVerificationResult> {
  const normalized = normalizePhone(phoneNumber);

  // Check if this phone already has a driver profile
  const db = await getDb();
  let isExistingUser = false;
  if (db) {
    const existing = await db
      .select({ id: phoneAuthSessions.id, driverProfileId: phoneAuthSessions.driverProfileId })
      .from(phoneAuthSessions)
      .where(eq(phoneAuthSessions.phoneNumber, normalized))
      .limit(1);
    isExistingUser = existing.length > 0 && existing[0].driverProfileId != null;
  }

  // Generate a 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  otpStore.set(normalized, { code, expiresAt });

  // Option B: return the code directly (no SMS)
  return { isExistingUser, code, expiresAt };
}

/**
 * Step 2: Verify the code the user entered.
 *
 * Option B: Checks the in-memory store.
 * Option A replacement: Call Twilio Verify check API.
 */
export async function checkVerification(
  phoneNumber: string,
  code: string
): Promise<PhoneConfirmResult> {
  const normalized = normalizePhone(phoneNumber);
  const stored = otpStore.get(normalized);

  if (!stored || stored.code !== code || Date.now() > stored.expiresAt) {
    return { success: false, isExistingUser: false, phoneNumber: normalized };
  }

  // Clear the used code
  otpStore.delete(normalized);

  // Check if existing user
  const db = await getDb();
  let isExistingUser = false;
  if (db) {
    const existing = await db
      .select({ driverProfileId: phoneAuthSessions.driverProfileId })
      .from(phoneAuthSessions)
      .where(eq(phoneAuthSessions.phoneNumber, normalized))
      .limit(1);
    isExistingUser = existing.length > 0 && existing[0].driverProfileId != null;
  }

  return { success: true, isExistingUser, phoneNumber: normalized };
}

/**
 * Bind a phone number to a driver profile after successful verification.
 * Creates or updates the phone_auth_sessions row.
 */
export async function bindPhoneToDriver(
  phoneNumber: string,
  driverProfileId: number,
  userId: number,
  deviceFingerprint?: string
): Promise<void> {
  const normalized = normalizePhone(phoneNumber);
  const db = await getDb();
  if (!db) return;

  await db
    .insert(phoneAuthSessions)
    .values({
      phoneNumber: normalized,
      driverProfileId,
      userId,
      deviceFingerprint: deviceFingerprint ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        driverProfileId,
        userId,
        deviceFingerprint: deviceFingerprint ?? null,
      },
    });
}

/**
 * Look up a driver profile by phone number.
 * Returns the driverProfileId if found, null otherwise.
 */
export async function getDriverByPhone(phoneNumber: string): Promise<number | null> {
  const normalized = normalizePhone(phoneNumber);
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({ driverProfileId: phoneAuthSessions.driverProfileId })
    .from(phoneAuthSessions)
    .where(eq(phoneAuthSessions.phoneNumber, normalized))
    .limit(1);

  return result.length > 0 ? (result[0].driverProfileId ?? null) : null;
}
