import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";

const MAX_RESENDS = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export const save = mutation({
  args: {
    driverCode: v.string(),
    clerkUserId: v.string(),
    vin: v.string(),
    year: v.optional(v.string()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    bodyType: v.optional(v.string()),
    color: v.optional(v.string()),
    notes: v.optional(v.string()),
    photoUrls: v.optional(v.array(v.string())),
    gpsLat: v.optional(v.float64()),
    gpsLng: v.optional(v.float64()),
    gpsAddress: v.optional(v.string()),
    reportedAt: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("fieldPickups", {
      ...args,
      status: "pending_sync",
    });
  },
});

export const markSynced = mutation({
  args: {
    id: v.id("fieldPickups"),
    platformResponse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "synced",
      syncedAt: new Date().toISOString(),
      platformResponse: args.platformResponse,
    });
  },
});

export const markFailed = mutation({
  args: {
    id: v.id("fieldPickups"),
    platformResponse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "failed",
      platformResponse: args.platformResponse,
    });
  },
});

export const getByDriver = query({
  args: { driverCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fieldPickups")
      .withIndex("by_driverCode", (q) => q.eq("driverCode", args.driverCode))
      .order("desc")
      .collect();
  },
});

export const resend = action({
  args: { id: v.id("fieldPickups") },
  handler: async (ctx, args): Promise<{ ok: true; resentCount: number } | { ok: false; reason: "cooldown"; availableAt: number } | { ok: false; reason: "limit_reached" }> => {
    const record = await ctx.runQuery(api.fieldPickups.getById, { id: args.id });
    if (!record) throw new Error("Field pickup record not found");

    const resentCount = record.resentCount ?? 0;
    if (resentCount >= MAX_RESENDS) {
      return { ok: false, reason: "limit_reached" };
    }

    if (record.lastResentAt) {
      const elapsed = Date.now() - new Date(record.lastResentAt).getTime();
      if (elapsed < COOLDOWN_MS) {
        return {
          ok: false,
          reason: "cooldown",
          availableAt: new Date(record.lastResentAt).getTime() + COOLDOWN_MS,
        };
      }
    }

    // Re-send to company platform
    try {
      await ctx.runAction(api.platform.reportFieldPickup, {
        driverCode: record.driverCode,
        vin: record.vin,
        year: record.year,
        make: record.make,
        model: record.model,
        bodyType: record.bodyType,
        color: record.color,
        notes: record.notes,
        photoUrls: record.photoUrls,
        gpsLat: record.gpsLat,
        gpsLng: record.gpsLng,
        gpsAddress: record.gpsAddress,
        reportedAt: record.reportedAt,
      });
    } catch (err) {
      throw new Error(`Platform sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const newCount = resentCount + 1;
    await ctx.runMutation(api.fieldPickups.updateResentMeta, {
      id: args.id,
      resentCount: newCount,
      lastResentAt: new Date().toISOString(),
    });

    return { ok: true, resentCount: newCount };
  },
});

export const getById = query({
  args: { id: v.id("fieldPickups") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const updateResentMeta = mutation({
  args: {
    id: v.id("fieldPickups"),
    resentCount: v.number(),
    lastResentAt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      resentCount: args.resentCount,
      lastResentAt: args.lastResentAt,
    });
  },
});
