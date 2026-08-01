/**
 * Photo upload progress helper.
 *
 * Computes the two numbers the company platform needs to render a
 * "X / Y photos uploaded" progress indicator on the dispatcher leg
 * card:
 *
 *   - `expected` — how many photos the driver actually captured for
 *     this inspection. Equal to `inspection.photos.length` — every
 *     captured photo has a slot in this array, regardless of whether
 *     it's been uploaded yet (still `file://...`) or already uploaded
 *     (HTTPS URL).
 *
 *   - `uploaded` — how many of those slots are already HTTPS URLs,
 *     i.e. photos that have finished uploading to R2 and are
 *     fetchable by the platform RIGHT NOW.
 *
 * Sending these alongside every status sync (markAsPickedUp,
 * markAsDelivered, syncInspection) lets dispatch distinguish:
 *   • "Driver only took 7 photos"           (expected=7,  uploaded=7)
 *   • "Driver took 30, 12 are visible"      (expected=30, uploaded=12)
 *   • "Upload stuck in a dead zone"         (expected=30, uploaded=7,
 *                                            and never advances)
 *
 * The contract is intentionally simple: two integers, both optional
 * on the platform side. When the platform receives them it can render
 * a progress bar; when it doesn't (older driver-app builds) it falls
 * back to "show whatever photos are attached." No breaking change.
 */

export interface PhotoUploadProgress {
  /** Total photos the driver captured for this inspection. */
  expected: number;
  /** Photos already on R2 (HTTPS URLs) and immediately viewable. */
  uploaded: number;
}

/**
 * Compute {expected, uploaded} from an inspection's photos array.
 *
 * Local file paths (`file://…`) count toward `expected` but NOT
 * `uploaded` — they haven't reached R2 yet. HTTPS URLs count toward
 * both. This means `uploaded ≤ expected` always.
 */
export function computePhotoProgress(photos: readonly string[] | undefined | null): PhotoUploadProgress {
  if (!photos || photos.length === 0) {
    return { expected: 0, uploaded: 0 };
  }
  let uploaded = 0;
  for (const p of photos) {
    if (p && p.startsWith("http")) uploaded++;
  }
  return { expected: photos.length, uploaded };
}
