/**
 * Company Platform API Client
 *
 * Typed HTTP client for the Prairie Auto Transport dispatch platform.
 * Uses the service-to-service API key stored in COMPANY_PLATFORM_API_KEY.
 *
 * tRPC v11 protocol:
 *   - Queries: GET /{procedure}?input={"json":{...}}
 *   - Mutations: POST /{procedure}  body: {"json":{...}}
 *   - Response envelope: { result: { data: { json: T } } } or { error: { json: {...} } }
 */

const BASE_URL =
  process.env.COMPANY_PLATFORM_URL ??
  "https://grateful-orca-398.convex.site/api/trpc";

const API_KEY = process.env.COMPANY_PLATFORM_API_KEY ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompanyPlatformLoad {
  legId?: number;  // per-leg unique identifier (preferred)
  tripId: number;  // legacy field
  loadNumber: string;
  vehicleCount: number;
  pickupLocation: {
    name: string;
    address: string;
    city: string;
    province: string;
    phone?: string;
    contactName?: string;
  };
  deliveryLocation: {
    name: string;
    address: string;
    city: string;
    province: string;
    phone?: string;
    contactName?: string;
  };
  pickupDate: string | number | null;
  deliveryDate: string | number | null;
  rate: string;
  vehicle: {
    vin: string;
    year: number | null;
    make: string | null;
    model: string | null;
    description: string;
  } | null;
  status: "pending" | "picked_up" | "delivered" | "cancelled";
  /** URL to the gate pass file attached by the dispatcher, if any */
  gatePassUrl?: string | null;
  /** ISO 8601 date string for gate pass expiry, if set by the dispatcher */
  storageExpiryDate?: string | null;
  /** Note from the previous leg's delivery driver for this leg's pickup driver */
  previousLegNotes?: string | null;
}

export interface SyncInspectionDamage {
  id: string;
  zone: string;
  type: string;
  severity: "minor" | "moderate" | "severe";
  x: number;  // normalized 0-1
  y: number;  // normalized 0-1
  diagramView?: string;
  note?: string;
}

export interface SyncInspectionAdditional {
  odometer?: string;
  drivable?: boolean;
  windscreen?: boolean;
  glassesIntact?: boolean;
  titlePresent?: boolean;
  billOfSale?: boolean;
  keys?: number;
  remotes?: number;
  headrests?: number;
  cargoCover?: boolean;
  spareTire?: boolean;
  radio?: boolean;
  manuals?: boolean;
  navigationDisk?: boolean;
  pluginChargerCable?: boolean;
  headphones?: boolean;
}

export interface SyncInspectionInput {
  loadNumber: string;
  legId: number;
  driverCode: string;
  inspectionType: "pickup" | "delivery";
  vehicleVin: string;
  photos: string[];  // S3 URLs
  damages: SyncInspectionDamage[];
  noDamage: boolean;
  gps: { lat: number; lng: number };
  timestamp: string;  // ISO 8601
  notes?: string;
  additionalInspection?: SyncInspectionAdditional;
  /** Driver's note for the next leg's driver (delivery inspections only) */
  handoffNote?: string;
}

export interface SyncInspectionResult {
  success: boolean;
  inspectionId: string | number;
  message: string;
}

export interface UpdateTripStatusInput {
  tripId: number;
  driverCode: string;
  status: "picked_up" | "delivered";
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

/**
 * tRPC v11 uses a JSON envelope: input must be wrapped as {"json": actualInput}
 * and responses come back as { result: { data: { json: T } } }
 */
async function callTRPC<T>(
  procedure: string,
  input: unknown,
  method: "query" | "mutation" = "query"
): Promise<T> {
  if (!API_KEY) {
    throw new Error("COMPANY_PLATFORM_API_KEY is not configured");
  }

  const url = `${BASE_URL}/${procedure}`;
  // Wrap input in tRPC v11 JSON envelope
  const envelope = { json: input };

  let response: Response;

  if (method === "query") {
    // tRPC queries: GET with ?input=<url-encoded-json-envelope>
    const params = new URLSearchParams({ input: JSON.stringify(envelope) });
    response = await fetch(`${url}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    });
  } else {
    // tRPC mutations: POST with body as json envelope
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
  }

  const responseText = await response.text();

  if (!response.ok) {
    // Try to extract tRPC error message
    try {
      const errJson = JSON.parse(responseText) as {
        error?: { json?: { message?: string; code?: string } };
      };
      const msg = errJson.error?.json?.message ?? responseText;
      const code = errJson.error?.json?.code ?? String(response.status);
      throw new Error(`[${code}] ${msg}`);
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr.message.startsWith("[")) throw parseErr;
      throw new Error(`Company platform API error ${response.status}: ${responseText}`);
    }
  }

  // Parse tRPC v11 response envelope: { result: { data: { json: T } } }
  const json = JSON.parse(responseText) as {
    result?: { data?: { json?: T } | T };
    error?: { json?: { message?: string } };
  };

  if (json.error) {
    const errJson = json.error as { json?: { message?: string } };
    throw new Error(`Company platform error: ${errJson.json?.message ?? JSON.stringify(json.error)}`);
  }

  if (json.result !== undefined) {
    const data = json.result.data;
    // tRPC v11 wraps in { json: T }
    if (data !== null && typeof data === "object" && "json" in (data as object)) {
      return (data as { json: T }).json;
    }
    return data as T;
  }

  return json as unknown as T;
}

// ─── API Methods ──────────────────────────────────────────────────────────────

/**
 * Fetch all loads assigned to a driver by their D-XXXXX code.
 * Returns an empty array if the driver is not found on the company platform.
 */
export async function getAssignedLoads(driverCode: string): Promise<CompanyPlatformLoad[]> {
  try {
    return await callTRPC<CompanyPlatformLoad[]>(
      "driversApi.getAssignedLoads",
      { driverCode },
      "query"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Driver not yet registered on company platform — return empty list gracefully
    if (msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("404")) {
      return [];
    }
    throw err;
  }
}


/**
 * Update the trip status (picked_up or delivered) without submitting photos.
 */
export async function updateTripStatus(
  input: UpdateTripStatusInput
): Promise<{ message: string }> {
  return callTRPC<{ message: string }>(
    "driversApi.updateTripStatus",
    input,
    "mutation"
  );
}

// ─── Invite Types ────────────────────────────────────────────────────────────

export interface CompanyPlatformInvite {
  inviteId: number;
  companyId: string;
  companyName: string;
  companyCode: string;
  companyLocation?: string | null;
  companyProvince?: string | null;
  invitedAt: string;
  message?: string;
}

/**
 * Fetch all pending invitations sent to a driver by their D-XXXXX code.
 * Returns an empty array if no invites exist.
 */
export async function getPendingInvites(driverCode: string): Promise<CompanyPlatformInvite[]> {
  try {
    const result = await callTRPC<CompanyPlatformInvite[]>(
      "driversApi.getPendingInvites",
      { driverCode },
      "query"
    );
    return Array.isArray(result) ? result : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("404")) {
      return [];
    }
    throw err;
  }
}

/**
 * Accept or decline a company invitation.
 * When accepted, the driver appears as Active in the company's Connected Drivers list.
 */
export async function respondToInvite(input: {
  inviteId: number;
  accept: boolean;
  driverCode: string;
}): Promise<{ message: string; success: boolean }> {
  return callTRPC<{ message: string; success: boolean }>(
    "driversApi.respondToInvite",
    input,
    "mutation"
  );
}

// ─── Mark As Picked Up ──────────────────────────────────────────────────────

export interface MarkAsPickedUpInput {
  loadNumber: string; // kept for backward compat — mapped to loadId on the wire
  legId: number;
  driverCode: string;
  pickupTime: string; // ISO 8601 timestamp
  pickupGPS: { lat: number; lng: number };
  pickupPhotos: string[]; // S3 URLs
}

export interface MarkAsPickedUpResult {
  message: string;
  success: boolean;
}

/**
 * Mark a vehicle as picked up on the company platform.
 * Sends loadNumber, legId, driverCode, pickupTime, pickupGPS, and pickupPhotos.
 */
export async function markAsPickedUp(
  input: MarkAsPickedUpInput
): Promise<MarkAsPickedUpResult> {
  // Map our internal field names to what the platform API expects:
  //   loadNumber → loadId
  //   pickupGPS.lat/lng → gpsLatitude / gpsLongitude
  //   pickupPhotos → photos
  const platformPayload = {
    loadId: input.loadNumber,
    legId: input.legId,
    driverCode: input.driverCode,
    pickupTime: input.pickupTime,
    gpsLatitude: input.pickupGPS.lat,
    gpsLongitude: input.pickupGPS.lng,
    photos: input.pickupPhotos,
  };
  return callTRPC<MarkAsPickedUpResult>(
    "driversApi.markAsPickedUp",
    platformPayload,
    "mutation"
  );
}

// ─── Mark as Delivered ──────────────────────────────────────────────────────

export interface MarkAsDeliveredInput {
  loadNumber: string;  // load number (e.g. "PAT-2026-00001")
  legId: number;
  driverCode: string;
  deliveryTime: string; // ISO 8601
  deliveryGPS: { lat: number; lng: number };
  deliveryPhotos: string[]; // S3 URLs
}

export interface MarkAsDeliveredResult {
  message: string;
  status: string;
  platformStatus?: string;
  isFinalDelivery?: boolean;
}

/**
 * Sync an inspection report (photos + damages) to the company platform.
 * Uses the new syncInspection endpoint with full x/y damage coordinates.
 */
export async function syncInspection(
  input: SyncInspectionInput
): Promise<SyncInspectionResult> {
  return callTRPC<SyncInspectionResult>(
    "driversApi.syncInspection",
    input,
    "mutation"
  );
}

/**
 * Mark a vehicle as delivered on the company platform.
 * Uses the same field mapping pattern as markAsPickedUp.
 */
export async function markAsDelivered(
  input: MarkAsDeliveredInput
): Promise<MarkAsDeliveredResult> {
  const platformPayload: Record<string, unknown> = {
    loadId: input.loadNumber,
    legId: input.legId,
    driverCode: input.driverCode,
    deliveryTime: input.deliveryTime,
    gpsLatitude: input.deliveryGPS.lat,
    gpsLongitude: input.deliveryGPS.lng,
    photos: input.deliveryPhotos,
  };
  return callTRPC<MarkAsDeliveredResult>(
    "driversApi.markAsDelivered",
    platformPayload,
    "mutation"
  );
}

// ─── Revert Pickup ──────────────────────────────────────────────────────────

export interface RevertPickupInput {
  loadId: string;   // load number (e.g. "PAT-2026-00001")
  legId: number;
  driverCode: string;
}

export interface RevertPickupResult {
  message: string;
  status: string;
}

/**
 * Revert a vehicle from picked_up back to assigned on the company platform.
 * Clears pickup date, GPS coordinates, and photos on the platform side.
 */
export async function revertPickup(
  input: RevertPickupInput
): Promise<RevertPickupResult> {
  return callTRPC<RevertPickupResult>(
    "driversApi.revertPickup",
    input,
    "mutation"
  );
}

// ─── Locations ──────────────────────────────────────────────────────────────

export interface PlatformLocation {
  id: number;
  name: string;
  address?: string;
  city?: string;
  province?: string;
  lat?: number;
  lng?: number;
}

/**
 * Fetch all locations from the company platform.
 * Returns an empty array if the endpoint is not yet available.
 */
export async function getLocations(): Promise<PlatformLocation[]> {
  try {
    return await callTRPC<PlatformLocation[]>(
      "driversApi.getLocations",
      {},
      "query"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Endpoint may not exist yet on the platform — return empty gracefully
    if (msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("404") || msg.includes("No \"query\"")) {
      console.warn("[Platform] getLocations endpoint not available yet, falling back to empty list");
      return [];
    }
    throw err;
  }
}

export interface CreateLocationInput {
  name: string;
  address?: string;
  city?: string;
  province?: string;
  lat?: number;
  lng?: number;
}

/**
 * Create a new location on the company platform.
 * Returns the created location or null if the endpoint is not yet available.
 */
export async function createLocation(
  input: CreateLocationInput
): Promise<PlatformLocation | null> {
  try {
    return await callTRPC<PlatformLocation>(
      "driversApi.createLocation",
      input,
      "mutation"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("404") || msg.includes("No \"mutation\"")) {
      console.warn("[Platform] createLocation endpoint not available yet");
      return null;
    }
    throw err;
  }
}

/**
 * Health check — verify the API key is valid by fetching loads for demo driver.
 * Returns true if the API key works (even if driver not found), false on auth error.
 */
export async function verifyApiKey(): Promise<boolean> {
  if (!API_KEY) return false;
  try {
    // This will either return [] (driver not found, but auth OK)
    // or throw on auth failure
    await getAssignedLoads("D-00001");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Auth errors
    if (msg.includes("401") || msg.includes("403") || msg.includes("Unauthorized")) {
      return false;
    }
    // Any other error (network, etc.) — still means key might be valid
    // Return true conservatively so we don't block the app
    return true;
  }
}

/**
 * Register a driver with the dispatcher platform.
 * Returns the platform-assigned driver ID (e.g. "D-12345") or null if the platform is unavailable.
 * This ID is what dispatchers use to invite the driver.
 *
 * The platform API uses a batch format: POST with body {"0":{"json":{...}}}
 * and returns [{"result":{"data":{"json":{driverId, message, isExisting}}}}]
 */
export async function registerDriver(
  name: string,
  phone: string,
  localDriverCode?: string
): Promise<string | null> {
  const normalizedPhone = phone && phone.trim() ? phone.trim() : "000-000-0000";
  const url = `${BASE_URL}/driversApi.registerDriver?batch=1`;

  const body = {
    "0": {
      json: {
        name,
        email: "",
        phone: normalizedPhone,
        truckType: "",
        capacity: 1,
        mcNumber: "",
        ...(localDriverCode ? { driverCode: localDriverCode } : {}),
      },
    },
  };

  try {
    // Retry once after 3s if platform is sleeping
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        break;
      } catch (fetchErr) {
        if (attempt === 0) {
          // Platform may be waking up — wait 3s and retry
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw fetchErr;
      }
    }

    if (!response) throw new Error("No response from platform");

    const text = await response.text();

    // Response is a batch array: [{result:{data:{json:{driverId,...}}}}]
    let parsed: Array<{ result?: { data?: { json?: { driverId?: string } } }; error?: unknown }>;
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      console.warn("[Platform] registerDriver: unexpected response:", text.slice(0, 200));
      return null;
    }

    const driverId = parsed?.[0]?.result?.data?.json?.driverId;
    if (!driverId) {
      console.warn("[Platform] registerDriver: no driverId in response:", text.slice(0, 200));
      return null;
    }
    return driverId;
  } catch (e) {
    console.warn("[Platform] registerDriver failed:", e);
    return null;
  }
}

// ─── Register Push Token ─────────────────────────────────────────────────────

/**
 * Register the driver's Expo push token with the company platform.
 * The platform stores this token and uses it to send push notifications
 * when a load is assigned to the driver.
 */
export async function registerPushToken(
  driverCode: string,
  pushToken: string
): Promise<boolean> {
  try {
    await callTRPC<{ success: boolean }>("driversApi.registerPushToken", { driverCode, pushToken }, "mutation");
    return true;
  } catch (e) {
    console.warn("[Platform] registerPushToken failed:", e);
    return false;
  }
}
