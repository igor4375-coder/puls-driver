/**
 * Gate Pass Expiry Notifier
 *
 * Runs once at server startup and then every day at 7:00 AM server time.
 * Finds gate passes that expire today (within the next 24 hours) and haven't
 * had a notification sent yet, then pushes an alert to the assigned driver.
 *
 * The driver code on the gate pass record is used to look up the driver's
 * push token. If no driver code is set, the notification is skipped.
 */

import { eq, and, isNotNull, isNull, lte, gte, sql } from "drizzle-orm";
import { getDb, getDriverProfileByCode, getDriverProfileByPlatformCode } from "./db";
import { gatePassFiles } from "../drizzle/schema";
import { sendPushNotification } from "./push";
import * as companyPlatform from "./company-platform-client";

/**
 * Send expiry notifications for gate passes expiring within the next 24 hours.
 * Marks each notified gate pass with the current timestamp to avoid duplicates.
 */
export async function sendGatePassExpiryNotifications(): Promise<void> {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find gate passes that:
    // 1. Have an expiry date within the next 24 hours (or already expired today)
    // 2. Have not yet been notified (notifiedExpiryAt is null)
    // 3. Have a driver code set
    const drizzleDb = await getDb();
    if (!drizzleDb) {
      console.log("[GatePassNotifier] No database connection — skipping.");
      return;
    }

    const passes = await drizzleDb
      .select()
      .from(gatePassFiles)
      .where(
        and(
          isNotNull(gatePassFiles.expiresAt),
          isNull(gatePassFiles.notifiedExpiryAt),
          isNotNull(gatePassFiles.driverCode),
          lte(gatePassFiles.expiresAt, in24h),
          gte(gatePassFiles.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)) // not expired more than 24h ago
        )
      );

    if (passes.length === 0) {
      console.log("[GatePassNotifier] No gate passes to notify about.");
      return;
    }

    console.log(`[GatePassNotifier] Found ${passes.length} gate pass(es) expiring soon.`);

    for (const pass of passes) {
      try {
        if (!pass.driverCode) continue;

        // Look up driver profile by local code first, then platform code
        let profile = await getDriverProfileByCode(pass.driverCode);
        if (!profile) {
          profile = await getDriverProfileByPlatformCode(pass.driverCode);
        }

        if (!profile?.pushToken) {
          console.log(`[GatePassNotifier] No push token for driver ${pass.driverCode} on load ${pass.loadId} — skipping.`);
          // Still mark as notified to avoid repeated lookups
          await drizzleDb
            .update(gatePassFiles)
            .set({ notifiedExpiryAt: now })
            .where(eq(gatePassFiles.id, pass.id));
          continue;
        }

        // Respect driver's gate pass expiry notification preference
        if (profile.notifyGatePassExpiry === false) {
          console.log(`[GatePassNotifier] Driver ${pass.driverCode} has gate pass expiry notifications disabled — skipping.`);
          continue;
        }

        const expiresAt = pass.expiresAt!;
        const isExpired = now > expiresAt;
        const expiryLabel = expiresAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const title = isExpired
          ? `Gate Pass Expired — Load ${pass.loadId}`
          : `Gate Pass Expiring Soon — Load ${pass.loadId}`;
        const body = isExpired
          ? `Your gate pass for load ${pass.loadId} expired at ${expiryLabel}. Contact your dispatcher for a new one.`
          : `Your gate pass for load ${pass.loadId} expires at ${expiryLabel}. Contact your dispatcher if you need a renewal.`;

        await sendPushNotification(
          profile.pushToken,
          title,
          body,
          { type: "gate_pass_expiry", loadId: pass.loadId },
          "loads"
        );

        // Mark as notified
        const db2 = await getDb();
        if (db2) {
          await db2
            .update(gatePassFiles)
            .set({ notifiedExpiryAt: now })
            .where(eq(gatePassFiles.id, pass.id));
        }

        console.log(`[GatePassNotifier] Notified driver ${pass.driverCode} about gate pass expiry for load ${pass.loadId}.`);
      } catch (err) {
        console.error(`[GatePassNotifier] Failed to notify for gate pass id=${pass.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[GatePassNotifier] Job failed:", err);
  }
}

/**
 * Send storage expiry notifications for loads whose storageExpiryDate is today.
 * Checks all assigned loads for each active driver and fires a push if the date matches.
 */
export async function sendStorageExpiryNotifications(): Promise<void> {
  try {
    const drizzleDb = await getDb();
    if (!drizzleDb) {
      console.log("[StorageExpiryNotifier] No database connection — skipping.");
      return;
    }

    // Get all active driver profiles that have a push token and storage expiry notifications enabled
    const profiles = await drizzleDb.execute(
      sql`SELECT id, driver_code, platform_driver_code, pushToken, notify_storage_expiry
          FROM driver_profiles
          WHERE pushToken IS NOT NULL
            AND notify_storage_expiry = 1
            AND status = 'active'`
    ) as any[];

    const rows = Array.isArray(profiles) ? profiles : (profiles as any).rows ?? [];
    if (rows.length === 0) {
      console.log("[StorageExpiryNotifier] No eligible drivers.");
      return;
    }

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

    for (const row of rows) {
      try {
        const driverCode: string = row.driver_code ?? row.driverCode;
        const platformCode: string | null = row.platform_driver_code ?? row.platformDriverCode ?? null;
        const pushToken: string = row.push_token ?? row.pushToken;
        const codeToUse = platformCode ?? driverCode;
        if (!codeToUse) continue;

        // Fetch assigned loads for this driver from the platform
        const loads = await companyPlatform.getAssignedLoads(codeToUse).catch(() => []);
        if (!loads || loads.length === 0) continue;

        for (const load of loads) {
          const storageExpiry: string | null = (load as any).storageExpiryDate ?? null;
          if (!storageExpiry) continue;

          const expiryDateStr = storageExpiry.split("T")[0];
          if (expiryDateStr !== todayStr) continue;

          // Fire storage expiry notification for this load
          const loadId = (load as any).id ?? (load as any).loadId ?? "unknown";
          await sendPushNotification(
            pushToken,
            `Storage Expires Today — Load ${loadId}`,
            `The vehicle on load ${loadId} must leave storage today. Contact your dispatcher if you need an extension.`,
            { type: "storage_expiry", loadId },
            "loads"
          );
          console.log(`[StorageExpiryNotifier] Notified driver ${driverCode} about storage expiry for load ${loadId}.`);
        }
      } catch (err) {
        console.error(`[StorageExpiryNotifier] Failed for driver row:`, err);
      }
    }
  } catch (err) {
    console.error("[StorageExpiryNotifier] Job failed:", err);
  }
}

/**
 * Schedule the gate pass expiry notifier to run every day at 7:00 AM.
 * Also runs once immediately at startup to catch any missed notifications.
 */
export function scheduleGatePassExpiryNotifier(): void {
  // Run once at startup (after a short delay to let the server settle)
  setTimeout(() => {
    sendGatePassExpiryNotifications().catch(console.error);
    sendStorageExpiryNotifications().catch(console.error);
  }, 10_000);

  // Schedule daily at 7:00 AM
  const scheduleNext = () => {
    const now = new Date();
    const next7am = new Date(now);
    next7am.setHours(7, 0, 0, 0);
    if (next7am <= now) {
      // Already past 7am today — schedule for tomorrow
      next7am.setDate(next7am.getDate() + 1);
    }
    const msUntil7am = next7am.getTime() - now.getTime();
    console.log(`[GatePassNotifier] Next check scheduled at ${next7am.toLocaleString()} (in ${Math.round(msUntil7am / 60000)} min)`);
    setTimeout(() => {
      sendGatePassExpiryNotifications().catch(console.error);
      sendStorageExpiryNotifications().catch(console.error);
      scheduleNext(); // reschedule for the next day
    }, msUntil7am);
  };

  scheduleNext();
}
