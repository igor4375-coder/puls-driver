/**
 * usePhotoQueue
 *
 * React hook that subscribes to the photo queue singleton and triggers
 * a periodic sync attempt while the component is mounted.
 */

import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { photoQueue, PhotoQueueEntry } from "@/lib/photo-queue";

const SYNC_INTERVAL_MS = 30_000; // re-check every 30 seconds

export function usePhotoQueue() {
  const [entries, setEntries] = useState<PhotoQueueEntry[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // The cleanup below used to be returned from inside `.then()`, which hands
    // it to the promise rather than to React. Nothing was ever torn down, so
    // every mount permanently leaked a queue subscriber, a 30s sync interval
    // and an AppState listener. A load screen mounts one of these per vehicle,
    // so opening a 16-vehicle load leaked 16 of each, every visit.
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        photoQueue.sync().catch(() => {});
      }
    });

    photoQueue.load().then(() => {
      if (cancelled) return;
      unsub = photoQueue.subscribe(setEntries);
      photoQueue.sync().catch(() => {});
      interval = setInterval(() => {
        photoQueue.sync().catch(() => {});
      }, SYNC_INTERVAL_MS);
      intervalRef.current = interval;
    });

    return () => {
      cancelled = true;
      unsub?.();
      if (interval) clearInterval(interval);
      appStateSub.remove();
    };
  }, []);

  // v65+: use `visibleStats` so entries that have been stuck pending
  // with a real upload error for >5 min surface to the driver as
  // "Failed" (with the Retry button) instead of hiding behind a "0
  // Failed" counter while the queue silently piles up.
  const stats = photoQueue.visibleStats;
  const hasPending = stats.pending > 0 || stats.uploading > 0;
  const hasFailed = stats.failed > 0;

  return {
    entries,
    stats,
    hasPending,
    hasFailed,
    sync: () => photoQueue.sync(),
    retryFailed: () => photoQueue.retryFailed(),
    resolvedUri: (clientId: string) => photoQueue.resolvedUri(clientId),
  };
}
