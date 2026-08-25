import type { SymbolViewProps } from "expo-symbols";
import type { Load } from "@/lib/data";

export type LoadNoteTone = "critical" | "warning" | "pickup" | "dropoff";

export interface LoadNote {
  key: string;
  label: string;
  text: string;
  tone: LoadNoteTone;
}

/** Palette mirrors the note callouts on the load detail screen so the list,
 *  the quick-view sheet and the detail screen all read the same way. */
export const NOTE_TONE_STYLES: Record<
  LoadNoteTone,
  { bg: string; border: string; label: string; body: string; accent: string; icon: SymbolViewProps["name"] }
> = {
  critical: { bg: "#FFEBEE", border: "#EF9A9A", label: "#B71C1C", body: "#3E2723", accent: "#C62828", icon: "exclamationmark.triangle.fill" },
  warning: { bg: "#FFF8E1", border: "#FFD54F", label: "#E65100", body: "#5D4037", accent: "#F9A825", icon: "note.text" },
  pickup: { bg: "#E8F5E9", border: "#A5D6A7", label: "#1B5E20", body: "#33691E", accent: "#2E7D32", icon: "arrow.up.circle.fill" },
  dropoff: { bg: "#FBE9E7", border: "#FFAB91", label: "#BF360C", body: "#4E342E", accent: "#D84315", icon: "arrow.down.circle.fill" },
};

/**
 * Every note attached to a load, ordered most urgent first. Used to flag notes
 * on the loads list and to render the quick-view sheet.
 */
export function collectLoadNotes(load: Load): LoadNote[] {
  const notes: LoadNote[] = [];
  const push = (key: string, label: string, tone: LoadNoteTone, text: string | null | undefined) => {
    const trimmed = text?.trim();
    if (trimmed) notes.push({ key, label, text: trimmed, tone });
  };

  push("dispatch", "Dispatch Notes", "critical", load.dispatchNotes);

  for (const vehicle of load.vehicles) {
    const vinLast6 = vehicle.vin && vehicle.vin.length >= 6 ? vehicle.vin.slice(-6).toUpperCase() : null;
    push(
      `previous-leg-${vehicle.id}`,
      vinLast6 ? `From Previous Driver · ${vinLast6}` : "From Previous Driver",
      "critical",
      vehicle.previousLegNotes,
    );
  }

  push("driver", "Driver Notes", "warning", load.driverNotes);
  push("pickup", "Pickup Instructions", "pickup", load.pickupInstructions);
  push("dropoff", "Drop-off Instructions", "dropoff", load.dropoffInstructions);

  // On platform loads `notes` is just dispatchNotes + driverNotes joined, so it
  // only carries anything new on manually added loads.
  if (!load.dispatchNotes?.trim() && !load.driverNotes?.trim()) {
    push("general", "Notes", "warning", load.notes);
  }

  return notes;
}

/** Collapses line breaks so a note can sit on a single line of a load card. */
export function noteToPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
