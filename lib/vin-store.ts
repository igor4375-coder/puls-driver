/**
 * VIN Result Store
 *
 * A simple in-memory store that lets the VIN scanner screen pass results
 * back to any screen that requested the scan. Uses a callback pattern
 * so the result is delivered reliably even after navigation.
 */

export interface VINDecodeResult {
  vin: string;
  year: string;
  make: string;
  model: string;
  bodyType: string;
  engineSize: string;
  trim: string;
  isPartial?: boolean; // true when only last-6 digits were entered
}

type VINCallback = (vehicleId: string, result: VINDecodeResult) => void;

/** Context that tells the scanner what to do after confirming a result */
export type VINLaunchContext = "add-load" | "existing-vehicle";

let _callback: VINCallback | null = null;
let _pendingVehicleId: string | null = null;
let _launchContext: VINLaunchContext = "existing-vehicle";

/** Register a callback to receive VIN scan results */
export function registerVINCallback(cb: VINCallback) {
  _callback = cb;
}

/** Unregister the callback (call on screen unmount) */
export function unregisterVINCallback() {
  _callback = null;
  _pendingVehicleId = null;
}

/** Set the vehicle ID that the scanner should return results for */
export function setPendingVehicleId(vehicleId: string) {
  _pendingVehicleId = vehicleId;
}

/** Set the launch context so the scanner knows where to navigate after confirm */
export function setVINLaunchContext(ctx: VINLaunchContext) {
  _launchContext = ctx;
}

/** Get the current launch context */
export function getVINLaunchContext(): VINLaunchContext {
  return _launchContext;
}

/** Get the vehicle ID that the scanner should return results for */
export function getPendingVehicleId(): string | null {
  return _pendingVehicleId;
}

/** Deliver a VIN result to the registered callback */
export function deliverVINResult(result: VINDecodeResult) {
  if (_callback && _pendingVehicleId) {
    _callback(_pendingVehicleId, result);
    _pendingVehicleId = null;
  }
}

// ─── Pending Load VIN Match ───────────────────────────────────────────────────

/**
 * Pending loads store — set by the loads screen before launching the scanner
 * so the scanner can match the scanned VIN against pending loads.
 * Each entry is { loadId, vin } for every vehicle in every pending load.
 */
export interface PendingLoadVIN {
  loadId: string;
  vin: string; // full VIN (may be empty string)
  loadNumber?: string; // e.g. "FLT-2024-002" for the toast
}

let _pendingLoadVINs: PendingLoadVIN[] = [];

/** Set the list of pending load VINs for match lookup */
export function setPendingLoadVINs(entries: PendingLoadVIN[]) {
  _pendingLoadVINs = entries;
}

/**
 * Try to find a pending load whose vehicle VIN last-6 matches the scanned VIN (last-6).
 * Returns { loadId, loadNumber } of the first match, or null if none.
 */
export function matchPendingLoadByLast6(scannedVin: string): { loadId: string; loadNumber?: string } | null {
  const scanned6 = scannedVin.trim().toUpperCase().slice(-6);
  if (scanned6.length < 6) return null;
  for (const entry of _pendingLoadVINs) {
    if (!entry.vin) continue;
    const load6 = entry.vin.trim().toUpperCase().slice(-6);
    if (load6.length >= 6 && load6 === scanned6) {
      return { loadId: entry.loadId, loadNumber: entry.loadNumber };
    }
  }
  return null;
}
