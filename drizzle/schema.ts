import { bigint, boolean, datetime, decimal, int, mysqlEnum, mysqlTable, text, timestamp, tinyint, varchar, uniqueIndex } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Companies ────────────────────────────────────────────────────────────────
// Represents a transport company (dispatcher side). Each company is linked to
// a Manus user account (the owner/dispatcher).
export const companies = mysqlTable("companies", {
  id: int("id").autoincrement().primaryKey(),
  /** The Manus user ID of the company owner/dispatcher */
  ownerId: int("ownerId").notNull(),
  /**
   * Permanent public company identity code in the format C-XXXXX (e.g. C-22341).
   * Used by drivers to identify and connect with a company.
   * Generated once on company creation and never changes.
   */
  companyCode: varchar("company_code", { length: 8 }).unique(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  address: text("address"),
  dotNumber: varchar("dotNumber", { length: 32 }),
  logoUrl: text("logoUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

// ─── Driver Profiles ──────────────────────────────────────────────────────────
// Represents a driver's profile in the system. A driver is a Manus user who
// has joined the platform. A driver can be connected to MULTIPLE companies
// simultaneously (see driver_company_links table).
export const driverProfiles = mysqlTable("driver_profiles", {
  id: int("id").autoincrement().primaryKey(),
  /** The Manus user ID of the driver */
  userId: int("userId").notNull().unique(),
  /**
   * Permanent public driver identity code in the format D-XXXXX (e.g. D-44651).
   * Drivers share this code with companies to receive invitations.
   * Generated once on first login and never changes.
   */
  driverCode: varchar("driver_code", { length: 8 }).unique(),
  /**
   * The platform-assigned driver ID (e.g. D-12345) from the dispatcher platform.
   * This is the ID that dispatchers use to invite the driver.
   * Stored here so it persists across app reinstalls and device changes.
   * Null until the driver successfully registers with the platform.
   */
  platformDriverCode: varchar("platform_driver_code", { length: 16 }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  licenseNumber: varchar("licenseNumber", { length: 64 }),
  truckNumber: varchar("truckNumber", { length: 64 }),
  trailerNumber: varchar("trailerNumber", { length: 64 }),
  /** Equipment type: tow_truck, flatbed, stinger, seven_car_carrier */
  equipmentType: mysqlEnum("equipment_type", ["tow_truck", "flatbed", "stinger", "seven_car_carrier"]),
  /** Vehicle capacity 1–10 */
  equipmentCapacity: tinyint("equipment_capacity"),
  /** Notify driver when a new load is assigned (default: true) */
  notifyNewLoad: boolean("notify_new_load").default(true).notNull(),
  /** Notify driver when a company sends an invite (default: true) */
  notifyNewInvite: boolean("notify_new_invite").default(true).notNull(),
  /** Notify driver when a gate pass is expiring within 24 hours (default: true) */
  notifyGatePassExpiry: boolean("notify_gate_pass_expiry").default(true).notNull(),
  /** Notify driver when a vehicle's storage expiry date is today (default: true) */
  notifyStorageExpiry: boolean("notify_storage_expiry").default(true).notNull(),
  status: mysqlEnum("status", ["active", "inactive", "suspended"]).default("active").notNull(),
  /** Push notification token for Expo notifications */
  pushToken: text("pushToken"),
  /**
   * Whether the driver's phone number has been verified.
   * In Option B (device-binding), this is set to true when the driver
   * first registers with a phone number on a device.
   * In Option A (Twilio OTP), this is set to true after OTP verification.
   * Switching from B → A only requires updating the phoneAuth service layer.
   */
  phoneVerified: boolean("phone_verified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DriverProfile = typeof driverProfiles.$inferSelect;
export type InsertDriverProfile = typeof driverProfiles.$inferInsert;

// ─── Phone Auth Sessions ──────────────────────────────────────────────────────
// Tracks phone-number → device bindings for Option B (device-based phone auth).
// Each row links a normalized phone number to a device fingerprint and the
// resulting driver profile. Unique constraint on phone_number ensures one
// permanent driver ID per phone number.
//
// UPGRADE PATH TO OPTION A (Twilio OTP):
//   1. Add `otpCode` and `otpExpiresAt` columns here.
//   2. Replace the `phoneAuth` service in server/phone-auth.ts with Twilio logic.
//   3. The frontend screens (phone-entry, phone-confirm) stay identical.
//   4. No other files need to change.
export const phoneAuthSessions = mysqlTable("phone_auth_sessions", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * E.164-normalized phone number (e.g. +12045551234).
   * UNIQUE — one permanent driver identity per phone number.
   */
  phoneNumber: varchar("phone_number", { length: 20 }).notNull().unique(),
  /**
   * Stable device fingerprint stored in SecureStore on the device.
   * Used in Option B to bind the phone number to the device that registered it.
   * In Option A (Twilio OTP), this field is still stored but not used for auth.
   */
  deviceFingerprint: varchar("device_fingerprint", { length: 128 }),
  /** The driver profile that owns this phone number. Set on first registration. */
  driverProfileId: int("driver_profile_id"),
  /** Manus user ID linked to this phone number. */
  userId: int("user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().onUpdateNow().notNull(),
});

export type PhoneAuthSession = typeof phoneAuthSessions.$inferSelect;
export type InsertPhoneAuthSession = typeof phoneAuthSessions.$inferInsert;

// ─── Driver-Company Links ─────────────────────────────────────────────────────
// Many-to-many relationship between drivers and companies.
// A driver can be connected to multiple companies simultaneously.
// A company can have multiple drivers.
// The link goes through an invitation flow:
//   1. Company sends invite to a driver by their D-XXXXX code
//   2. Driver sees the pending invite in their app
//   3. Driver accepts or declines
//   4. If accepted, status becomes "active" and the company can assign loads
//   5. Either party can remove the connection (status → "removed")
export const driverCompanyLinks = mysqlTable("driver_company_links", {
  id: int("id").autoincrement().primaryKey(),
  driverProfileId: int("driver_profile_id").notNull(),
  companyId: int("company_id").notNull(),
  status: mysqlEnum("status", ["pending", "active", "declined", "removed"]).default("pending").notNull(),
  invitedAt: timestamp("invited_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
});

export type DriverCompanyLink = typeof driverCompanyLinks.$inferSelect;
export type InsertDriverCompanyLink = typeof driverCompanyLinks.$inferInsert;

// ─── Company Invitations (legacy — kept for backward compat) ──────────────────
// The old code-based invite system. Superseded by D-XXXXX / C-XXXXX identity
// codes and driver_company_links, but kept in the schema to avoid breaking
// existing migrations.
export const companyInvitations = mysqlTable("company_invitations", {
  id: int("id").autoincrement().primaryKey(),
  companyId: int("companyId").notNull(),
  /** The unique invite code the driver enters in the app */
  code: varchar("code", { length: 16 }).notNull().unique(),
  /** Optional: pre-fill the driver's name when they join */
  driverName: varchar("driverName", { length: 255 }),
  /** Optional: the email the invite was sent to */
  driverEmail: varchar("driverEmail", { length: 320 }),
  /** The driver profile ID once the invite is accepted */
  acceptedByDriverId: int("acceptedByDriverId"),
  status: mysqlEnum("status", ["pending", "accepted", "expired", "revoked"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CompanyInvitation = typeof companyInvitations.$inferSelect;
export type InsertCompanyInvitation = typeof companyInvitations.$inferInsert;

// ─── Load Expenses ────────────────────────────────────────────────────────────
// Driver-submitted expenses tied to a specific load (e.g. loading fees, tolls,
// fuel). Each expense can have an optional receipt photo stored in S3.
// The company platform reads these via the getExpensesByLoad endpoint.
export const loadExpenses = mysqlTable("load_expenses", {
  id: int("id").autoincrement().primaryKey(),
  /** The load this expense belongs to (platform trip ID or local load ID) */
  loadId: varchar("load_id", { length: 64 }).notNull(),
  /** Driver's local D-XXXXX code — used to scope expenses to the driver */
  driverCode: varchar("driver_code", { length: 16 }).notNull(),
  /** Human-readable label, e.g. "Loading Fee", "Fuel", "Toll" */
  label: varchar("label", { length: 128 }).notNull(),
  /** Amount in cents to avoid floating-point issues */
  amountCents: int("amount_cents").notNull(),
  /** ISO date string YYYY-MM-DD */
  expenseDate: varchar("expense_date", { length: 10 }).notNull(),
  /** S3 URL of the receipt photo (optional) */
  receiptUrl: text("receipt_url"),
  /** S3 key for deletion */
  receiptKey: varchar("receipt_key", { length: 512 }),
  /** Optional driver notes, e.g. "paid cash at gate" */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LoadExpense = typeof loadExpenses.$inferSelect;
export type InsertLoadExpense = typeof loadExpenses.$inferInsert;

// ─── Gate Pass Files ──────────────────────────────────────────────────────────
// Stores gate pass documents (PDF or image) attached to a load by the dispatcher.
// A load can have at most one gate pass at a time (delete + re-upload to replace).
export const gatePassFiles = mysqlTable("gate_pass_files", {
  id: int("id").autoincrement().primaryKey(),
  /** Platform load number (e.g. PAT-2026-00001) */
  loadId: varchar("load_id", { length: 64 }).notNull(),
  /** Company code of the dispatcher who uploaded (C-XXXXX) */
  companyCode: varchar("company_code", { length: 16 }).notNull(),
  /** Optional driver code (D-XXXXX or platform code) to notify on expiry */
  driverCode: varchar("driver_code", { length: 16 }),
  /** Public S3 URL of the gate pass file */
  fileUrl: text("file_url").notNull(),
  /** S3 key for deletion */
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  /** Original file name (e.g. gate-pass.pdf) */
  fileName: varchar("file_name", { length: 255 }).notNull(),
  /** MIME type: image/jpeg, image/png, application/pdf */
  mimeType: varchar("mime_type", { length: 64 }).notNull(),
  /** File size in bytes */
  fileSizeBytes: int("file_size_bytes"),
  /** Optional expiry date/time for the gate pass */
  expiresAt: datetime("expires_at"),
  /** Timestamp when the expiry push notification was last sent (to avoid duplicates) */
  notifiedExpiryAt: datetime("notified_expiry_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type GatePassFile = typeof gatePassFiles.$inferSelect;
export type InsertGatePassFile = typeof gatePassFiles.$inferInsert;

// ─── Load Signatures ──────────────────────────────────────────────────────────
// Stores pickup and delivery signatures captured by the driver on the mobile app.
// Each row represents one signature event (pickup or delivery) for a load.
// customerSig and driverSig are SVG path data strings (serialized from the canvas).
export const loadSignatures = mysqlTable("load_signatures", {
  id: int("id").autoincrement().primaryKey(),
  /** Platform load number (e.g. PAT-2026-00001) */
  loadId: varchar("load_id", { length: 64 }).notNull(),
  /** Driver's D-XXXXX code */
  driverCode: varchar("driver_code", { length: 16 }).notNull(),
  /** "pickup" or "delivery" */
  signatureType: mysqlEnum("signature_type", ["pickup", "delivery"]).notNull(),
  /** Name of the customer who signed (if present) */
  customerName: varchar("customer_name", { length: 128 }),
  /** SVG path data for the customer signature (null if customer was not available) */
  customerSig: text("customer_sig"),
  /** SVG path data for the driver signature */
  driverSig: text("driver_sig"),
  /** True when the customer was not present at pickup/delivery */
  customerNotAvailable: boolean("customer_not_available").default(false).notNull(),
  /** ISO 8601 timestamp of when the signature was captured */
  capturedAt: varchar("captured_at", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LoadSignature = typeof loadSignatures.$inferSelect;
export type InsertLoadSignature = typeof loadSignatures.$inferInsert;

// ─── Driver Locations ────────────────────────────────────────────────────────
// Stores the most recent location pings reported by each driver.
// Only the latest row per driver matters for real-time tracking; older rows
// serve as a lightweight breadcrumb trail for the company platform.
export const driverLocations = mysqlTable("driver_locations", {
  id: int("id").autoincrement().primaryKey(),
  driverCode: varchar("driver_code", { length: 16 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracy: decimal("accuracy", { precision: 8, scale: 2 }),
  speed: decimal("speed", { precision: 8, scale: 2 }),
  heading: decimal("heading", { precision: 6, scale: 2 }),
  /** Epoch ms from the device GPS reading */
  deviceTimestamp: bigint("device_timestamp", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DriverLocation = typeof driverLocations.$inferSelect;
export type InsertDriverLocation = typeof driverLocations.$inferInsert;
