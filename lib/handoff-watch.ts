import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Load } from "@/lib/data";
import {
  detectHandoffReadyTransitions,
  handoffReadyNotificationCopy,
  snapshotHandoffWatch,
  type HandoffWatchSnapshot,
} from "@/lib/handoff";
import { sendLocalNotification } from "@/lib/push-notifications";

function storageKey(driverCode: string): string {
  return `@puls:handoff-watch:${driverCode}`;
}

async function readStoredSnapshots(driverCode: string): Promise<HandoffWatchSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(driverCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HandoffWatchSnapshot[]) : [];
  } catch {
    return [];
  }
}

async function writeStoredSnapshots(driverCode: string, snapshots: HandoffWatchSnapshot[]): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(driverCode), JSON.stringify(snapshots));
  } catch {
    // Non-critical — next poll will try again.
  }
}

/**
 * Compare the last known handoff state to this fetch. Notify when a unit
 * moves from awaiting handoff to ready at the terminal. Persists snapshots
 * so a restart still catches the flip.
 */
export async function maybeNotifyHandoffReady(
  driverCode: string,
  previousLoads: Load[],
  nextLoads: Load[],
): Promise<void> {
  if (!driverCode) return;

  const stored = await readStoredSnapshots(driverCode);
  const previous =
    stored.length > 0 ? stored : previousLoads.map(snapshotHandoffWatch);
  const next = nextLoads.map(snapshotHandoffWatch);
  const ready = detectHandoffReadyTransitions(previous, next);
  await writeStoredSnapshots(driverCode, next);

  for (const snap of ready) {
    const { title, subtitle, body } = handoffReadyNotificationCopy(snap);
    try {
      await sendLocalNotification(
        title,
        body,
        { type: "handoff_ready", loadId: snap.id, loadNumber: snap.loadNumber },
        `handoff-ready-${snap.id}`,
        { subtitle, color: "#2E7D32" },
      );
    } catch (err) {
      console.warn("[Handoff] ready notification failed:", err);
    }
  }
}
