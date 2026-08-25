import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Keep the table small — these are debugging aids, not records of value. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const reportFields = {
  kind: v.union(
    v.literal("abnormal_termination"),
    v.literal("js_error"),
    v.literal("memory_warning"),
  ),
  sessionId: v.string(),
  driverCode: v.optional(v.string()),
  buildTag: v.optional(v.string()),
  updateId: v.optional(v.string()),
  platform: v.optional(v.string()),
  osVersion: v.optional(v.string()),
  deviceModel: v.optional(v.string()),
  totalMemoryBytes: v.optional(v.float64()),
  message: v.optional(v.string()),
  stack: v.optional(v.string()),
  appState: v.optional(v.string()),
  route: v.optional(v.string()),
  photoQueueTotal: v.optional(v.number()),
  photoQueuePending: v.optional(v.number()),
  photoQueueUploading: v.optional(v.number()),
  photoQueueFailed: v.optional(v.number()),
  photoQueueBytes: v.optional(v.float64()),
  syncQueueDepth: v.optional(v.number()),
  memoryWarnings: v.optional(v.number()),
  breadcrumbs: v.optional(v.array(v.string())),
  sessionStartedAt: v.optional(v.float64()),
  lastHeartbeatAt: v.optional(v.float64()),
  silentForMs: v.optional(v.float64()),
};

export const report = mutation({
  args: reportFields,
  handler: async (ctx, args) => {
    await ctx.db.insert("clientDiagnostics", {
      ...args,
      reportedAt: new Date().toISOString(),
    });
  },
});

/** Batched flush — the app buffers reports on disk while offline. */
export const reportBatch = mutation({
  args: { reports: v.array(v.object(reportFields)) },
  handler: async (ctx, args) => {
    const reportedAt = new Date().toISOString();
    for (const r of args.reports) {
      await ctx.db.insert("clientDiagnostics", { ...r, reportedAt });
    }
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("clientDiagnostics")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const recentForDriver = query({
  args: { driverCode: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("clientDiagnostics")
      .withIndex("by_driverCode", (q) => q.eq("driverCode", args.driverCode))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const prune = mutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    const stale = await ctx.db
      .query("clientDiagnostics")
      .order("asc")
      .take(500);
    let removed = 0;
    for (const row of stale) {
      if (row.reportedAt >= cutoff) break;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return { removed };
  },
});
