/**
 * Handoff-ready notifier
 *
 * Polls assigned loads for drivers with a push token. When a unit flips from
 * awaiting_handoff → ready_for_pickup, push the assigned driver so they do
 * not have to keep opening the order.
 */

import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { sendPushNotification } from "./push";
import * as companyPlatform from "./company-platform-client";
import type { CompanyPlatformLoad } from "./company-platform-client";

type Snapshot = {
  id: string;
  loadNumber: string;
  vehicleLabel: string;
  handoffState: "awaiting_handoff" | "ready_for_pickup" | null;
  pickupLocationName: string | null;
};

type EligibleDriver = {
  code: string;
  pushToken: string;
};

const lastByDriver = new Map<string, Snapshot[]>();
const POLL_MS = 60_000;

function snapshotFromPlatformLoad(load: CompanyPlatformLoad): Snapshot {
  const v = load.vehicle;
  const parts = [v?.year, v?.make, v?.model].filter(Boolean);
  const loc = load.handoff?.pickupLocationName || load.pickupLocation?.name || null;
  return {
    id: `platform-${load.legId ?? load.tripId}`,
    loadNumber: load.loadNumber,
    vehicleLabel: parts.length > 0 ? parts.join(" ") : (v?.description || `Load ${load.loadNumber}`),
    handoffState: load.handoff?.state ?? null,
    pickupLocationName: loc,
  };
}

function detectReady(previous: Snapshot[], next: Snapshot[]): Snapshot[] {
  const prevById = new Map(previous.map((s) => [s.id, s]));
  return next.filter((n) => {
    const p = prevById.get(n.id);
    return p?.handoffState === "awaiting_handoff" && n.handoffState === "ready_for_pickup";
  });
}

function copyFor(s: Snapshot): { title: string; body: string } {
  const who = s.vehicleLabel || `Load ${s.loadNumber}`;
  const loc = s.pickupLocationName;
  return {
    title: "Ready for Pickup",
    body: loc
      ? `${who} is at ${loc} now.`
      : `${who} is at the terminal and ready to pick up.`,
  };
}

async function loadEligibleDrivers(): Promise<EligibleDriver[]> {
  const drizzleDb = await getDb();
  if (!drizzleDb) return [];

  const profiles = await drizzleDb.execute(
    sql`SELECT driver_code, platform_driver_code, pushToken, notify_new_load
        FROM driver_profiles
        WHERE pushToken IS NOT NULL
          AND status = 'active'`,
  ) as any[];

  const rows = Array.isArray(profiles) ? profiles : (profiles as any).rows ?? [];
  const out: EligibleDriver[] = [];
  for (const row of rows) {
    const driverCode: string = row.driver_code ?? row.driverCode;
    const platformCode: string | null = row.platform_driver_code ?? row.platformDriverCode ?? null;
    const pushToken: string = row.push_token ?? row.pushToken;
    if (!pushToken) continue;
    const code = platformCode || driverCode;
    if (!code) continue;
    out.push({ code, pushToken });
  }
  return out;
}

async function checkDriver(driver: EligibleDriver): Promise<void> {
  const loads = await companyPlatform.getAssignedLoads(driver.code).catch(() => []);
  const next = (loads ?? []).map(snapshotFromPlatformLoad);
  const previous = lastByDriver.get(driver.code);
  lastByDriver.set(driver.code, next);

  if (!previous) return; // first sighting is the baseline — no notify

  const ready = detectReady(previous, next);
  for (const snap of ready) {
    const { title, body } = copyFor(snap);
    await sendPushNotification(
      driver.pushToken,
      title,
      body,
      { type: "handoff_ready", loadId: snap.id, loadNumber: snap.loadNumber },
      "loads",
    );
    console.log(`[HandoffReady] Notified ${driver.code} — ${snap.loadNumber} (${snap.id})`);
  }
}

export async function pollHandoffReadyNotifications(): Promise<void> {
  try {
    const drivers = await loadEligibleDrivers();
    if (drivers.length === 0) return;
    for (const driver of drivers) {
      try {
        await checkDriver(driver);
      } catch (err) {
        console.error(`[HandoffReady] Failed for ${driver.code}:`, err);
      }
    }
  } catch (err) {
    console.error("[HandoffReady] Poll failed:", err);
  }
}

export function scheduleHandoffReadyNotifier(): void {
  setTimeout(() => {
    pollHandoffReadyNotifications().catch(console.error);
  }, 15_000);

  setInterval(() => {
    pollHandoffReadyNotifications().catch(console.error);
  }, POLL_MS);

  console.log(`[HandoffReady] Polling assigned loads every ${POLL_MS / 1000}s`);
}
