"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

const BASE_URL = process.env.COMPANY_PLATFORM_URL ?? "";
const API_KEY = process.env.COMPANY_PLATFORM_API_KEY ?? "";

async function callTRPC<T>(
  procedure: string,
  input: unknown,
  method: "query" | "mutation" = "query",
): Promise<T> {
  const url = `${BASE_URL}/${procedure}`;
  const envelope = { json: input };

  let response: Response;

  if (method === "query") {
    const params = new URLSearchParams({ input: JSON.stringify(envelope) });
    response = await fetch(`${url}?${params.toString()}`, {
      method: "GET",
      headers: {
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        "Content-Type": "application/json",
      },
    });
  } else {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
  }

  const responseText = await response.text();

  if (!response.ok) {
    try {
      const errJson = JSON.parse(responseText) as {
        error?: { json?: { message?: string; code?: string } };
      };
      const msg = errJson.error?.json?.message ?? responseText;
      const code = errJson.error?.json?.code ?? String(response.status);
      throw new Error(`[${code}] ${msg}`);
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr.message.startsWith("[")) throw parseErr;
      throw new Error(`Platform API error ${response.status}: ${responseText}`);
    }
  }

  const json = JSON.parse(responseText) as {
    result?: { data?: { json?: T } | T };
    error?: { json?: { message?: string } };
  };

  if (json.error) {
    const errJson = json.error as { json?: { message?: string } };
    throw new Error(`Platform error: ${errJson.json?.message ?? JSON.stringify(json.error)}`);
  }

  if (json.result !== undefined) {
    const data = json.result.data;
    if (data !== null && typeof data === "object" && "json" in (data as object)) {
      return (data as { json: T }).json;
    }
    return data as T;
  }

  return json as unknown as T;
}

export const getAssignedLoads = action({
  args: { driverCode: v.string() },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return [];
    try {
      return await callTRPC<unknown[]>(
        "driversApi.getAssignedLoads",
        { driverCode: args.driverCode },
        "query",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("404")) {
        return [];
      }
      throw err;
    }
  },
});

export const syncInspection = action({
  args: {
    loadNumber: v.string(),
    legId: v.union(v.number(), v.string()),
    driverCode: v.string(),
    inspectionType: v.union(v.literal("pickup"), v.literal("delivery")),
    vehicleVin: v.string(),
    photos: v.array(v.string()),
    damages: v.array(v.any()),
    noDamage: v.boolean(),
    gps: v.object({ lat: v.number(), lng: v.number() }),
    timestamp: v.string(),
    notes: v.optional(v.string()),
    handoffNote: v.optional(v.string()),
    additionalInspection: v.optional(v.any()),
  },
  handler: async (_ctx, args) => {
    return await callTRPC("driversApi.syncInspection", args, "mutation");
  },
});

export const markAsPickedUp = action({
  args: {
    loadNumber: v.string(),
    legId: v.union(v.number(), v.string()),
    driverCode: v.string(),
    pickupTime: v.string(),
    pickupGPS: v.object({ lat: v.number(), lng: v.number() }),
    pickupPhotos: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const payload = {
      loadId: args.loadNumber,
      legId: args.legId,
      driverCode: args.driverCode,
      pickupTime: args.pickupTime,
      gpsLatitude: args.pickupGPS.lat,
      gpsLongitude: args.pickupGPS.lng,
      photos: args.pickupPhotos,
    };
    return await callTRPC("driversApi.markAsPickedUp", payload, "mutation");
  },
});

export const markAsDelivered = action({
  args: {
    loadNumber: v.string(),
    legId: v.union(v.number(), v.string()),
    driverCode: v.string(),
    deliveryTime: v.string(),
    deliveryGPS: v.object({ lat: v.number(), lng: v.number() }),
    deliveryPhotos: v.array(v.string()),
    alternateDropLocationId: v.optional(v.string()),
    newLocation: v.optional(
      v.object({
        name: v.string(),
        address: v.optional(v.string()),
        city: v.string(),
        province: v.string(),
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    const payload: Record<string, unknown> = {
      loadId: args.loadNumber,
      legId: args.legId,
      driverCode: args.driverCode,
      deliveryTime: args.deliveryTime,
      gpsLatitude: args.deliveryGPS.lat,
      gpsLongitude: args.deliveryGPS.lng,
      photos: args.deliveryPhotos,
    };
    if (args.alternateDropLocationId) {
      payload.alternateDropLocationId = args.alternateDropLocationId;
    }
    if (args.newLocation) {
      payload.newLocation = args.newLocation;
    }
    return await callTRPC("driversApi.markAsDelivered", payload, "mutation");
  },
});

export const revertPickup = action({
  args: {
    loadNumber: v.string(),
    legId: v.union(v.number(), v.string()),
    driverCode: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return await callTRPC(
      "driversApi.revertPickup",
      {
        loadId: args.loadNumber,
        legId: args.legId,
        driverCode: args.driverCode,
        reason: args.reason,
      },
      "mutation",
    );
  },
});

export const updateTripStatus = action({
  args: {
    tripId: v.number(),
    driverCode: v.string(),
    status: v.union(v.literal("picked_up"), v.literal("delivered")),
  },
  handler: async (_ctx, args) => {
    return await callTRPC("driversApi.updateTripStatus", args, "mutation");
  },
});

export const getPendingInvites = action({
  args: { driverCode: v.string() },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return [];
    try {
      const result = await callTRPC<unknown[]>(
        "driversApi.getPendingInvites",
        { driverCode: args.driverCode },
        "query",
      );
      return Array.isArray(result) ? result : [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NOT_FOUND") || msg.includes("not found") || msg.includes("404")) {
        return [];
      }
      throw err;
    }
  },
});

export const respondToInvite = action({
  args: {
    inviteId: v.union(v.number(), v.string()),
    accept: v.boolean(),
    driverCode: v.string(),
    exclusive: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    return await callTRPC("driversApi.respondToInvite", args, "mutation");
  },
});

export const registerDriver = action({
  args: {
    name: v.string(),
    phone: v.string(),
    driverCode: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return null;
    const normalizedPhone = args.phone?.trim() || "000-000-0000";
    const url = `${BASE_URL}/driversApi.registerDriver?batch=1`;
    const body = {
      "0": {
        json: {
          name: args.name,
          email: "",
          phone: normalizedPhone,
          truckType: "",
          capacity: 1,
          mcNumber: "",
          ...(args.driverCode ? { driverCode: args.driverCode } : {}),
        },
      },
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await response.text();
      let parsed: Array<{ result?: { data?: { json?: { driverId?: string } } } }>;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }

      return parsed?.[0]?.result?.data?.json?.driverId ?? null;
    } catch {
      return null;
    }
  },
});

export const registerPushToken = action({
  args: { driverCode: v.string(), pushToken: v.string() },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return false;
    try {
      await callTRPC("driversApi.registerPushToken", args, "mutation");
      return true;
    } catch {
      return false;
    }
  },
});

export const reportLocation = action({
  args: {
    driverCode: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    heading: v.optional(v.number()),
    speed: v.optional(v.number()),
    accuracy: v.optional(v.number()),
    batteryLevel: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return false;
    try {
      await callTRPC("driversApi.reportLocation", args, "mutation");
      return true;
    } catch (err) {
      console.warn("[Platform] reportLocation failed:", err);
      return false;
    }
  },
});

export const getLocations = action({
  args: { orgId: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return [];
    try {
      const input: Record<string, string> = {};
      if (args.orgId) input.orgId = args.orgId;
      return await callTRPC<unknown[]>("driversApi.getLocations", input, "query");
    } catch {
      return [];
    }
  },
});

export const reportFieldPickup = action({
  args: {
    driverCode: v.string(),
    vin: v.string(),
    year: v.optional(v.string()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    bodyType: v.optional(v.string()),
    color: v.optional(v.string()),
    notes: v.optional(v.string()),
    photoUrls: v.optional(v.array(v.string())),
    gpsLat: v.optional(v.number()),
    gpsLng: v.optional(v.number()),
    gpsAddress: v.optional(v.string()),
    reportedAt: v.string(),
  },
  handler: async (_ctx, args) => {
    if (!BASE_URL) throw new Error("Company platform URL not configured");
    return await callTRPC("driversApi.reportFieldPickup", args, "mutation");
  },
});

export const getDriverPermissions = action({
  args: { driverCode: v.string() },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return { canViewRates: true, exclusive: false };
    try {
      const result = await callTRPC<{ canViewRates?: boolean; exclusive?: boolean }>(
        "driversApi.getDriverPermissions",
        { driverCode: args.driverCode },
        "query",
      );
      return {
        canViewRates: result?.canViewRates !== false,
        exclusive: result?.exclusive === true,
      };
    } catch {
      return { canViewRates: true, exclusive: false };
    }
  },
});

export const createLocation = action({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    province: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    if (!BASE_URL) return null;
    try {
      return await callTRPC("driversApi.createLocation", args, "mutation");
    } catch {
      return null;
    }
  },
});
