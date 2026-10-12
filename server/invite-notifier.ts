/**
 * Company-invite notifier
 *
 * Invites raised on the dispatch platform never reached the driver. The only
 * push for an invite came from our own inviteDriverByCode router, which
 * covers companies we host — not the platform ones, which is where the
 * complaints came from. Polling pending invites per driver closes that gap
 * and works with the app closed, which the in-app poll cannot.
 */

import { sql } from "drizzle-orm";

import { getDb } from "./db";
import { sendPushNotification } from "./push";
import * as companyPlatform from "./company-platform-client";

type EligibleDriver = {
  code: string;
  pushToken: string;
};

/** Invite ids already pushed, per driver code. */
const seenByDriver = new Map<string, Set<string>>();
const POLL_MS = 60_000;

async function loadEligibleDrivers(): Promise<EligibleDriver[]> {
  const drizzleDb = await getDb();
  if (!drizzleDb) return [];

  const profiles = (await drizzleDb.execute(
    sql`SELECT driver_code, platform_driver_code, pushToken, notify_new_invite
        FROM driver_profiles
        WHERE pushToken IS NOT NULL
          AND status = 'active'`,
  )) as any[];

  const rows = Array.isArray(profiles) ? profiles : (profiles as any).rows ?? [];
  const out: EligibleDriver[] = [];
  for (const row of rows) {
    const notify = row.notify_new_invite ?? row.notifyNewInvite;
    if (notify === false || notify === 0) continue;
    const pushToken: string = row.push_token ?? row.pushToken;
    if (!pushToken) continue;
    const code = (row.platform_driver_code ?? row.platformDriverCode) || (row.driver_code ?? row.driverCode);
    if (!code) continue;
    out.push({ code, pushToken });
  }
  return out;
}

async function checkDriver(driver: EligibleDriver): Promise<void> {
  const invites = await companyPlatform.getPendingInvites(driver.code).catch(() => []);
  const next = new Set((invites ?? []).map((i) => String(i.inviteId)));
  const previous = seenByDriver.get(driver.code);
  seenByDriver.set(driver.code, next);

  // First sighting is the baseline. Without it a restart would re-push every
  // invite the driver has been sitting on, and the in-app banner already
  // covers anything that predates us.
  if (!previous) return;

  for (const invite of invites ?? []) {
    const id = String(invite.inviteId);
    if (previous.has(id)) continue;
    const company = invite.companyName || "A company";
    await sendPushNotification(
      driver.pushToken,
      "📩 New Company Invite",
      `${company} wants to add you to their fleet. Tap to accept or decline.`,
      { type: "invite", inviteId: id, companyName: company },
      "invites",
      { subtitle: "Waiting for your answer", color: "#E65100" },
    );
    console.log(`[Invites] Notified ${driver.code} — invite ${id} from ${company}`);
  }
}

export async function pollInviteNotifications(): Promise<void> {
  try {
    const drivers = await loadEligibleDrivers();
    if (drivers.length === 0) return;
    for (const driver of drivers) {
      try {
        await checkDriver(driver);
      } catch (err) {
        console.error(`[Invites] Failed for ${driver.code}:`, err);
      }
    }
  } catch (err) {
    console.error("[Invites] Poll failed:", err);
  }
}

export function scheduleInviteNotifier(): void {
  setTimeout(() => {
    pollInviteNotifications().catch(console.error);
  }, 20_000);

  setInterval(() => {
    pollInviteNotifications().catch(console.error);
  }, POLL_MS);

  console.log(`[Invites] Polling pending invites every ${POLL_MS / 1000}s`);
}
