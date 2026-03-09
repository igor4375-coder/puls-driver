import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const save = mutation({
  args: {
    loadId: v.string(),
    driverCode: v.string(),
    signatureType: v.union(v.literal("pickup"), v.literal("delivery")),
    customerName: v.optional(v.string()),
    customerSig: v.optional(v.string()),
    driverSig: v.optional(v.string()),
    customerNotAvailable: v.boolean(),
    capturedAt: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("loadSignatures", args);
  },
});

export const getByLoad = query({
  args: { loadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("loadSignatures")
      .withIndex("by_loadId", (q) => q.eq("loadId", args.loadId))
      .collect();
  },
});
