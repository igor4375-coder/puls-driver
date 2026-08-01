import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";

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

export const deleteProfile = mutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("driverProfiles")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    if (!profile) return;

    // Remove company links
    const links = await ctx.db
      .query("driverCompanyLinks")
      .withIndex("by_driverProfileId", (q) => q.eq("driverProfileId", profile._id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    await ctx.db.delete(profile._id);
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
    monthlyRevenueGoal: v.optional(v.number()),
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

/**
 * Admin-only — toggle the multi-account ("Linked Accounts") feature for a
 * specific driver by their D-XXXXX code. Run from Convex dashboard or CLI.
 *
 * Example:
 *   npx convex run driverProfiles:setMultiAccountEnabled '{"driverCode":"D-XXXXX","enabled":true}'
 */
export const setMultiAccountEnabled = mutation({
  args: {
    driverCode: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("driverProfiles")
      .withIndex("by_driverCode", (q) => q.eq("driverCode", args.driverCode))
      .unique();
    if (!profile) {
      throw new Error(`Driver profile not found for code ${args.driverCode}`);
    }
    await ctx.db.patch(profile._id, { multiAccountEnabled: args.enabled });
    return await ctx.db.get(profile._id);
  },
});

/**
 * Admin-only — find a driver profile by email or partial-name match. Useful for
 * looking up a driver code to feed into setMultiAccountEnabled.
 *
 * Example:
 *   npx convex run driverProfiles:adminFindByEmail '{"email":"someone@example.com"}'
 */
export const adminFindByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const lower = args.email.trim().toLowerCase();
    const all = await ctx.db.query("driverProfiles").collect();
    return all.filter((p) => (p.email ?? "").toLowerCase() === lower);
  },
});

/**
 * Admin-only — list every driver profile (id, code, name, email, phone) for
 * lookup. Run from the CLI; never called by the app.
 *
 * Example:
 *   npx convex run driverProfiles:adminListAll
 */
export const adminListAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("driverProfiles").collect();
    return all.map((p) => ({
      driverCode: p.driverCode,
      platformDriverCode: p.platformDriverCode ?? null,
      name: p.name,
      email: p.email ?? null,
      phone: p.phone ?? null,
      multiAccountEnabled: p.multiAccountEnabled === true,
    }));
  },
});
