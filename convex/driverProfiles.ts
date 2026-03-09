import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function generateDriverCode(): string {
  const num = Math.floor(10000 + Math.random() * 90000);
  return `D-${num}`;
}

export const getOrCreateProfile = mutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("driverProfiles")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (existing) {
      return existing;
    }

    let driverCode = generateDriverCode();
    let attempts = 0;
    while (attempts < 10) {
      const collision = await ctx.db
        .query("driverProfiles")
        .withIndex("by_driverCode", (q) => q.eq("driverCode", driverCode))
        .unique();
      if (!collision) break;
      driverCode = generateDriverCode();
      attempts++;
    }

    const id = await ctx.db.insert("driverProfiles", {
      clerkUserId: args.clerkUserId,
      driverCode,
      name: args.name,
      phone: args.phone,
      email: args.email,
      phoneVerified: !!args.phone,
      notifyNewLoad: true,
      notifyNewInvite: true,
      notifyGatePassExpiry: true,
      notifyStorageExpiry: true,
      status: "active",
    });

    return await ctx.db.get(id);
  },
});

export const getByClerkUserId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("driverProfiles")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});

export const getByDriverCode = query({
  args: { driverCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("driverProfiles")
      .withIndex("by_driverCode", (q) => q.eq("driverCode", args.driverCode))
      .unique();
  },
});

export const updateProfile = mutation({
  args: {
    clerkUserId: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    truckNumber: v.optional(v.string()),
    trailerNumber: v.optional(v.string()),
    equipmentType: v.optional(
      v.union(
        v.literal("tow_truck"),
        v.literal("flatbed"),
        v.literal("stinger"),
        v.literal("seven_car_carrier"),
      ),
    ),
    equipmentCapacity: v.optional(v.number()),
    notifyNewLoad: v.optional(v.boolean()),
    notifyNewInvite: v.optional(v.boolean()),
    notifyGatePassExpiry: v.optional(v.boolean()),
    notifyStorageExpiry: v.optional(v.boolean()),
    pushToken: v.optional(v.string()),
    platformDriverCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("driverProfiles")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    if (!profile) throw new Error("Driver profile not found");

    const { clerkUserId: _, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(filtered).length > 0) {
      await ctx.db.patch(profile._id, filtered);
    }

    return await ctx.db.get(profile._id);
  },
});
