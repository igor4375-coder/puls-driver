/**
 * Offline Photo Queue — singleton export.
 *
 * The PhotoQueue class lives in photo-queue-class.ts for testability.
 * This file exports the app-wide singleton and re-exports types.
 */

export { PhotoQueue } from "./photo-queue-class";
export type { PhotoQueueEntry, PhotoStatus, StampMeta } from "./photo-queue-class";

import { PhotoQueue } from "./photo-queue-class";

// ─── App-wide singleton ───────────────────────────────────────────────────────

export const photoQueue = new PhotoQueue();
