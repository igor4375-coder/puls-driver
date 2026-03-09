import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getOrCreateCompany = mutation({
  args: {
    companyCode: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_companyCode", (q) => q.eq("companyCode", args.companyCode))
      .unique();

    if (existing) return existing;

    const id = await ctx.db.insert("companies", {
      companyCode: args.companyCode,
      name: args.name,
    });
    return await ctx.db.get(id);
  },
});

export const getMyCompanies = query({
  args: { driverProfileId: v.id("driverProfiles") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("driverCompanyLinks")
      .withIndex("by_driverProfileId", (q) =>
        q.eq("driverProfileId", args.driverProfileId),
      )
      .collect();

    const activeLinks = links.filter((l) => l.status === "active");

    const results = [];
    for (const link of activeLinks) {
      const company = await ctx.db.get(link.companyId);
      if (company) {
        results.push({
          linkId: link._id,
          companyId: link.companyId,
          status: link.status,
          company: {
            name: company.name,
            companyCode: company.companyCode,
            email: company.email,
            phone: company.phone,
          },
        });
      }
    }
    return results;
  },
});

export const getMyCompaniesByClerkUserId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("driverProfiles")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!profile) return [];

    const links = await ctx.db
      .query("driverCompanyLinks")
      .withIndex("by_driverProfileId", (q) =>
        q.eq("driverProfileId", profile._id),
      )
      .collect();

    const activeLinks = links.filter((l) => l.status === "active");

    const results = [];
    for (const link of activeLinks) {
      const company = await ctx.db.get(link.companyId);
      if (company) {
        results.push({
          linkId: link._id,
          companyId: link.companyId,
          status: link.status,
          company: {
            name: company.name,
            companyCode: company.companyCode,
            email: company.email,
            phone: company.phone,
          },
        });
      }
    }
    return results;
  },
});

export const updateCompanyCode = mutation({
  args: {
    companyId: v.id("companies"),
    companyCode: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.companyId, { companyCode: args.companyCode });
    return { success: true };
  },
});

export const removeCompany = mutation({
  args: {
    linkId: v.id("driverCompanyLinks"),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Company link not found");
    await ctx.db.patch(args.linkId, { status: "removed" });
    return { success: true };
  },
});

export const acceptInviteLocally = mutation({
  args: {
    clerkUserId: v.string(),
    companyCode: v.string(),
    companyName: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("driverProfiles")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (!profile) throw new Error("Driver profile not found");

    let company = await ctx.db
      .query("companies")
      .withIndex("by_companyCode", (q) => q.eq("companyCode", args.companyCode))
      .unique();

    if (!company) {
      const companyId = await ctx.db.insert("companies", {
        companyCode: args.companyCode,
        name: args.companyName,
      });
      company = await ctx.db.get(companyId);
    }

    if (!company) throw new Error("Failed to create company record");

    const existingLink = await ctx.db
      .query("driverCompanyLinks")
      .withIndex("by_driver_and_company", (q) =>
        q.eq("driverProfileId", profile._id).eq("companyId", company!._id),
      )
      .unique();

    if (existingLink) {
      if (existingLink.status !== "active") {
        await ctx.db.patch(existingLink._id, {
          status: "active",
          respondedAt: Date.now(),
        });
      }
      return { success: true };
    }

    await ctx.db.insert("driverCompanyLinks", {
      driverProfileId: profile._id,
      companyId: company._id,
      status: "active",
      respondedAt: Date.now(),
    });

    return { success: true };
  },
});
