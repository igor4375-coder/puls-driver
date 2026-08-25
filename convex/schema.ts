import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  driverProfiles: defineTable({
    clerkUserId: v.string(),
    driverCode: v.string(),
    platformDriverCode: v.optional(v.string()),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    phoneVerified: v.boolean(),
    licenseNumber: v.optional(v.string()),
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
    notifyNewLoad: v.boolean(),
    notifyNewInvite: v.boolean(),
    notifyGatePassExpiry: v.boolean(),
    notifyStorageExpiry: v.boolean(),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("suspended")),
    pushToken: v.optional(v.string()),
    monthlyRevenueGoal: v.optional(v.number()),
    /** When true, surfaces the "Linked Accounts" UI in profile/settings so this
     *  driver can sign in to a second Clerk account and swap between them with
     *  one tap. Off by default; flip to true per-driver as needed. */
    multiAccountEnabled: v.optional(v.boolean()),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_driverCode", ["driverCode"])
    .index("by_platformDriverCode", ["platformDriverCode"])
    .index("by_phone", ["phone"]),

  companies: defineTable({
    companyCode: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    dotNumber: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    /** Platform org id (Clerk/Convex org) — needed for driversApi.leaveCompany */
    companyOrgId: v.optional(v.string()),
  }).index("by_companyCode", ["companyCode"]),

  driverCompanyLinks: defineTable({
    driverProfileId: v.id("driverProfiles"),
    companyId: v.id("companies"),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("declined"),
      v.literal("removed"),
    ),
    exclusive: v.optional(v.boolean()),
    respondedAt: v.optional(v.number()),
  })
    .index("by_driverProfileId", ["driverProfileId"])
    .index("by_companyId", ["companyId"])
    .index("by_driver_and_company", ["driverProfileId", "companyId"]),

  loadExpenses: defineTable({
    loadId: v.string(),
    driverCode: v.string(),
    label: v.string(),
    amountCents: v.number(),
    expenseDate: v.string(),
    receiptUrl: v.optional(v.string()),
    receiptStorageId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
  })
    .index("by_loadId", ["loadId"])
    .index("by_driverCode", ["driverCode"]),

  gatePassFiles: defineTable({
    loadId: v.string(),
    companyCode: v.string(),
    driverCode: v.optional(v.string()),
    fileUrl: v.string(),
    storageId: v.optional(v.id("_storage")),
    fileName: v.string(),
    mimeType: v.string(),
    fileSizeBytes: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    notifiedExpiryAt: v.optional(v.number()),
  })
    .index("by_loadId", ["loadId"])
    .index("by_loadId_companyCode", ["loadId", "companyCode"]),

  loadSignatures: defineTable({
    loadId: v.string(),
    driverCode: v.string(),
    signatureType: v.union(v.literal("pickup"), v.literal("delivery")),
    customerName: v.optional(v.string()),
    customerSig: v.optional(v.string()),
    driverSig: v.optional(v.string()),
    customerNotAvailable: v.boolean(),
    capturedAt: v.string(),
  })
    .index("by_loadId", ["loadId"])
    .index("by_driverCode", ["driverCode"]),

  inspectionPhotos: defineTable({
    loadId: v.string(),
    vehicleId: v.string(),
    driverCode: v.string(),
    inspectionType: v.union(v.literal("pickup"), v.literal("delivery")),
    zone: v.optional(v.string()),
    damageId: v.optional(v.string()),
    storageKey: v.string(),
    thumbnailKey: v.optional(v.string()),
    url: v.string(),
    thumbnailUrl: v.optional(v.string()),
    fileSizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    gpsLat: v.optional(v.float64()),
    gpsLng: v.optional(v.float64()),
    capturedAt: v.string(),
    uploadedAt: v.string(),
    clientId: v.string(),
  })
    .index("by_load_vehicle", ["loadId", "vehicleId"])
    .index("by_load_type", ["loadId", "inspectionType"])
    .index("by_clientId", ["clientId"])
    .index("by_driverCode", ["driverCode"]),

  fieldPickups: defineTable({
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
    status: v.union(
      v.literal("pending_sync"),
      v.literal("synced"),
      v.literal("failed"),
    ),
    platformResponse: v.optional(v.string()),
    reportedAt: v.string(),
    syncedAt: v.optional(v.string()),
    resentCount: v.optional(v.number()),
    lastResentAt: v.optional(v.string()),
  })
    .index("by_driverCode", ["driverCode"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_vin", ["vin"])
    .index("by_status", ["status"]),

  /**
   * Client-side diagnostics. The driver app has no native crash reporter, so
   * an OS-level kill (out-of-memory jetsam, watchdog timeout) leaves no trace
   * at all — no JS error is ever thrown. Instead the app heartbeats a session
   * record to disk; if a session is found on the next launch it means the
   * process died without shutting down, and we report it here along with the
   * state it was in when it stopped breathing.
   */
  clientDiagnostics: defineTable({
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
    /** App state at the last heartbeat. "active" means it died in the
     *  driver's hands, which is the case worth paging on. */
    appState: v.optional(v.string()),
    route: v.optional(v.string()),
    photoQueueTotal: v.optional(v.number()),
    photoQueuePending: v.optional(v.number()),
    photoQueueUploading: v.optional(v.number()),
    photoQueueFailed: v.optional(v.number()),
    /** Size of the persisted photo queue payload. A queue that cannot drain
     *  grows without bound and is what exhausted the JS heap in the v84
     *  crashes, so it is worth watching directly. */
    photoQueueBytes: v.optional(v.float64()),
    syncQueueDepth: v.optional(v.number()),
    memoryWarnings: v.optional(v.number()),
    breadcrumbs: v.optional(v.array(v.string())),
    sessionStartedAt: v.optional(v.float64()),
    lastHeartbeatAt: v.optional(v.float64()),
    /** Gap between the final heartbeat and the next launch. */
    silentForMs: v.optional(v.float64()),
    reportedAt: v.string(),
  })
    .index("by_driverCode", ["driverCode"])
    .index("by_kind", ["kind"]),
});
