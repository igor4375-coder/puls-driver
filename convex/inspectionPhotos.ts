import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const save = mutation({
  args: {
    loadId: v.string(),
    vehicleId: v.string(),
    driverCode: v.string(),
    inspectionType: v.union(v.literal("pickup"), v.literal("delivery")),
    zone: v.optional(v.string()),
    damageId: v.optional(v.string()),
    storageKey: v.string(),
    url: v.string(),
    thumbnailKey: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    gpsLat: v.optional(v.float64()),
    gpsLng: v.optional(v.float64()),
    capturedAt: v.string(),
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("inspectionPhotos")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .unique();

    if (existing) return existing._id;

    return await ctx.db.insert("inspectionPhotos", {
      ...args,
      uploadedAt: new Date().toISOString(),
    });
  },
});

export const getByLoadAndVehicle = query({
  args: {
    loadId: v.string(),
    vehicleId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inspectionPhotos")
      .withIndex("by_load_vehicle", (q) =>
        q.eq("loadId", args.loadId).eq("vehicleId", args.vehicleId),
      )
      .collect();
  },
});

export const getByLoad = query({
  args: { loadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inspectionPhotos")
      .withIndex("by_load_vehicle", (q) => q.eq("loadId", args.loadId))
      .collect();
  },
});
