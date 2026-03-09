import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { loadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gatePassFiles")
      .withIndex("by_loadId", (q) => q.eq("loadId", args.loadId))
      .first();
  },
});

export const upsert = mutation({
  args: {
    loadId: v.string(),
    companyCode: v.string(),
    driverCode: v.optional(v.string()),
    fileUrl: v.string(),
    storageId: v.optional(v.id("_storage")),
    fileName: v.string(),
    mimeType: v.string(),
    fileSizeBytes: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("gatePassFiles")
      .withIndex("by_loadId_companyCode", (q) =>
        q.eq("loadId", args.loadId).eq("companyCode", args.companyCode),
      )
      .first();

    if (existing) {
      if (existing.storageId) {
        await ctx.storage.delete(existing.storageId);
      }
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("gatePassFiles", args);
  },
});

export const remove = mutation({
  args: { loadId: v.string(), companyCode: v.string() },
  handler: async (ctx, args) => {
    const gatePass = await ctx.db
      .query("gatePassFiles")
      .withIndex("by_loadId_companyCode", (q) =>
        q.eq("loadId", args.loadId).eq("companyCode", args.companyCode),
      )
      .first();

    if (!gatePass) return { success: false };

    if (gatePass.storageId) {
      await ctx.storage.delete(gatePass.storageId);
    }

    await ctx.db.delete(gatePass._id);
    return { success: true };
  },
});

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
