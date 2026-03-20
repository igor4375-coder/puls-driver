import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const add = mutation({
  args: {
    loadId: v.string(),
    driverCode: v.string(),
    label: v.string(),
    amountCents: v.number(),
    expenseDate: v.string(),
    receiptUrl: v.optional(v.string()),
    receiptStorageId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("loadExpenses", args);
  },
});

export const getByLoad = query({
  args: { loadId: v.string() },
  handler: async (ctx, args) => {
    const expenses = await ctx.db
      .query("loadExpenses")
      .withIndex("by_loadId", (q) => q.eq("loadId", args.loadId))
      .collect();
    return Promise.all(
      expenses.map(async (e) => ({
        ...e,
        receiptUrl: e.receiptStorageId
          ? await ctx.storage.getUrl(e.receiptStorageId)
          : e.receiptUrl ?? null,
      })),
    );
  },
});

export const getByDriver = query({
  args: { driverCode: v.string() },
  handler: async (ctx, args) => {
    const expenses = await ctx.db
      .query("loadExpenses")
      .withIndex("by_driverCode", (q) => q.eq("driverCode", args.driverCode))
      .collect();
    return Promise.all(
      expenses.map(async (e) => ({
        ...e,
        receiptUrl: e.receiptStorageId
          ? await ctx.storage.getUrl(e.receiptStorageId)
          : e.receiptUrl ?? null,
      })),
    );
  },
});

export const remove = mutation({
  args: { id: v.id("loadExpenses"), driverCode: v.string() },
  handler: async (ctx, args) => {
    const expense = await ctx.db.get(args.id);
    if (!expense) throw new Error("Expense not found");
    if (expense.driverCode !== args.driverCode) throw new Error("Not authorized");

    if (expense.receiptStorageId) {
      await ctx.storage.delete(expense.receiptStorageId);
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
