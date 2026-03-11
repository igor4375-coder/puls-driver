import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
