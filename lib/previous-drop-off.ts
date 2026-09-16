import type { Load, PreviousDropOff, PreviousDropOffSource } from "@/lib/data";

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function httpsPhotos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && u.startsWith("http"));
}

/**
 * Normalize the platform `previousDropOff` payload. Returns null when there
 * are no photos and no note/keys — matching the platform contract — so older
 * loads without the field stay empty.
 */
export function normalizePreviousDropOff(raw: unknown): PreviousDropOff | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const photos = httpsPhotos(o.photos);
  const note = trimOrNull(o.note);
  const keysLocation = trimOrNull(o.keysLocation);
  if (photos.length === 0 && !note && !keysLocation) return null;

  const source: PreviousDropOffSource =
    o.source === "customer" ? "customer" : "previous_driver";

  return {
    source,
    driverName: trimOrNull(o.driverName),
    droppedAt: trimOrNull(o.droppedAt),
    locationName: trimOrNull(o.locationName),
    note,
    keysLocation,
    photos,
  };
}

export function formatDroppedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime()) || date.getFullYear() < 1971) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function previousDropOffSourceLabel(source: PreviousDropOffSource | null | undefined): string {
  return source === "customer" ? "Customer" : "Previous driver";
}

/** Note shown in the card: prefer previousDropOff.note, else previousLegNotes. */
export function previousDropOffDisplayNote(
  previousDropOff: PreviousDropOff | null | undefined,
  fallbackNote?: string | null,
): string | null {
  return trimOrNull(previousDropOff?.note) ?? trimOrNull(fallbackNote);
}

export function fallbackPreviousLegNote(load: Load | null | undefined): string | null {
  if (!load) return null;
  for (const vehicle of load.vehicles) {
    const note = trimOrNull(vehicle.previousLegNotes);
    if (note) return note;
  }
  return null;
}
