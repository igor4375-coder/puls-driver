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
  })
    .index("by_driverCode", ["driverCode"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_vin", ["vin"])
    .index("by_status", ["status"]),
});
