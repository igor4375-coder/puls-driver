import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  companies,
  driverProfiles,
  driverCompanyLinks,
  companyInvitations,
  loadExpenses,
  gatePassFiles,
  loadSignatures,
  driverLocations,
  type InsertCompany,
  type InsertDriverProfile,
  type InsertCompanyInvitation,
  type InsertLoadExpense,
  type InsertGatePassFile,
  type InsertLoadSignature,
  type InsertDriverLocation,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Identity Code Generators ─────────────────────────────────────────────────

/** Generate a unique D-XXXXX driver code (5 numeric digits after prefix) */
function generateDriverCode(): string {
  const num = Math.floor(10000 + Math.random() * 90000); // 10000–99999
  return `D-${num}`;
}

/** Generate a unique C-XXXXX company code (5 numeric digits after prefix) */
function generateCompanyCode(): string {
  const num = Math.floor(10000 + Math.random() * 90000); // 10000–99999
  return `C-${num}`;
}

/** Ensure a driver code is unique in the DB, retrying up to 10 times */
async function uniqueDriverCode(): Promise<string> {
  const db = await getDb();
  if (!db) return generateDriverCode(); // offline fallback

  for (let i = 0; i < 10; i++) {
    const code = generateDriverCode();
    const existing = await db
      .select({ id: driverProfiles.id })
      .from(driverProfiles)
      .where(eq(driverProfiles.driverCode, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error("Could not generate a unique driver code after 10 attempts");
}

/** Ensure a company code is unique in the DB, retrying up to 10 times */
async function uniqueCompanyCode(): Promise<string> {
  const db = await getDb();
  if (!db) return generateCompanyCode();

  for (let i = 0; i < 10; i++) {
    const code = generateCompanyCode();
    const existing = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.companyCode, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error("Could not generate a unique company code after 10 attempts");
}

// ─── Company Helpers ──────────────────────────────────────────────────────────

export async function getOrCreateCompany(ownerId: number, name: string, email?: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(companies).where(eq(companies.ownerId, ownerId)).limit(1);
  if (existing.length > 0) return existing[0];

  const companyCode = await uniqueCompanyCode();

  const result = await db.insert(companies).values({
    ownerId,
    name,
    email: email ?? undefined,
    companyCode,
  });
  const rows = await db.select().from(companies).where(eq(companies.id, result[0].insertId)).limit(1);
  return rows[0];
}

export async function getCompanyByOwnerId(ownerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(companies).where(eq(companies.ownerId, ownerId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCompanyById(companyId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCompanyByCode(companyCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(companies)
    .where(eq(companies.companyCode, companyCode.toUpperCase()))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateCompany(companyId: number, data: Partial<InsertCompany>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(companies).set(data).where(eq(companies.id, companyId));
}

/**
 * Get or create a company record for a platform-managed company (invited via the dispatcher platform).
 * Platform companies don't have a local Manus user owner, so we use ownerId = 0 as a sentinel.
 * Lookup is by companyCode (the platform's company code, e.g. "C-12345").
 * If the companyCode is empty or missing, falls back to name-based lookup among ownerId=0 companies.
 */
export async function getOrCreatePlatformCompany(
  companyCode: string,
  companyName: string
): Promise<typeof companies.$inferSelect> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedCode = companyCode?.toUpperCase() ?? "";

  // 1. Try to find by company_code first (most reliable)
  if (normalizedCode) {
    const byCode = await db
      .select()
      .from(companies)
      .where(eq(companies.companyCode, normalizedCode))
      .limit(1);
    if (byCode.length > 0) return byCode[0];
  }

  // 2. Not found — create a new platform company record
  //    Use ownerId = 0 as a sentinel for "platform-managed" (no local owner)
  const result = await db.insert(companies).values({
    ownerId: 0,
    name: companyName,
    companyCode: normalizedCode || undefined,
  });
  const rows = await db
    .select()
    .from(companies)
    .where(eq(companies.id, result[0].insertId))
    .limit(1);
  return rows[0];
}

/**
 * Create or activate a driver-company link for a platform invite acceptance.
 * Finds or creates the company record, then creates/updates the link to "active".
 */
export async function acceptPlatformInvite(
  driverProfileId: number,
  companyCode: string,
  companyName: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get or create the local company record
  const company = await getOrCreatePlatformCompany(companyCode, companyName);

  // Check for an existing link
  const existing = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.companyId, company.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing link to active
    await db
      .update(driverCompanyLinks)
      .set({ status: "active", respondedAt: new Date() })
      .where(eq(driverCompanyLinks.id, existing[0].id));
  } else {
    // Create a new active link
    await db.insert(driverCompanyLinks).values({
      driverProfileId,
      companyId: company.id,
      status: "active",
      invitedAt: new Date(),
      respondedAt: new Date(),
    });
  }
}

// ─── Driver Profile Helpers ───────────────────────────────────────────────────

export async function getDriverProfileByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDriverProfileById(driverProfileId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.id, driverProfileId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDriverProfileByCode(driverCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.driverCode, driverCode.toUpperCase()))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Look up a driver profile by their platform-assigned driver code (e.g. D-68544).
 * Used as a fallback when the local driverCode is not available.
 */
export async function getDriverProfileByPlatformCode(platformCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.platformDriverCode, platformCode.toUpperCase()))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get or create a driver profile for the given user.
 * On first call, generates a permanent D-XXXXX code for the driver.
 */
export async function getOrCreateDriverProfile(userId: number, name: string, email?: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getDriverProfileByUserId(userId);
  if (existing) return existing;

  const driverCode = await uniqueDriverCode();

  const result = await db.insert(driverProfiles).values({
    userId,
    name,
    email: email ?? undefined,
    driverCode,
  });
  const rows = await db
    .select()
    .from(driverProfiles)
    .where(eq(driverProfiles.id, result[0].insertId))
    .limit(1);
  return rows[0];
}

export async function updateDriverProfile(driverProfileId: number, data: Partial<InsertDriverProfile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(driverProfiles).set(data).where(eq(driverProfiles.id, driverProfileId));
}

/**
 * Upsert a driver profile by driverCode, storing the push token.
 * Creates a synthetic user row if needed (for Clerk SSO drivers
 * whose profiles only exist in Convex, not Railway MySQL).
 */
export async function upsertDriverPushToken(
  driverCode: string,
  pushToken: string,
  opts?: { platformDriverCode?: string; name?: string; phone?: string },
) {
  const db = await getDb();
  if (!db) return;
  const upperCode = driverCode.toUpperCase();

  let profile = await getDriverProfileByCode(upperCode);
  if (!profile && opts?.platformDriverCode) {
    profile = await getDriverProfileByPlatformCode(opts.platformDriverCode);
  }

  if (profile) {
    const updates: Partial<InsertDriverProfile> = { pushToken };
    if (opts?.platformDriverCode) updates.platformDriverCode = opts.platformDriverCode;
    if (opts?.name) updates.name = opts.name;
    await db.update(driverProfiles).set(updates).where(eq(driverProfiles.id, profile.id));
    return;
  }

  const openId = `push-sync:${upperCode}`;
  await upsertUser({ openId, name: opts?.name ?? "Driver", loginMethod: "push-sync", lastSignedIn: new Date() });
  const user = await getUserByOpenId(openId);
  if (!user) return;

  await db.insert(driverProfiles).values({
    userId: user.id,
    driverCode: upperCode,
    platformDriverCode: opts?.platformDriverCode ?? null,
    name: opts?.name ?? "Driver",
    phone: opts?.phone ?? null,
    pushToken,
  });
}

// ─── Driver-Company Link Helpers ──────────────────────────────────────────────

/**
 * Get all active company connections for a driver (status = "active").
 */
export async function getDriverConnections(driverProfileId: number) {
  const db = await getDb();
  if (!db) return [];
  const links = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.status, "active")
      )
    );
  // Enrich with company details
  const enriched = await Promise.all(
    links.map(async (link) => {
      const company = await getCompanyById(link.companyId);
      return { ...link, company };
    })
  );
  return enriched;
}

/**
 * Get all pending invites for a driver (status = "pending").
 */
export async function getDriverPendingInvites(driverProfileId: number) {
  const db = await getDb();
  if (!db) return [];
  const links = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.status, "pending")
      )
    );
  const enriched = await Promise.all(
    links.map(async (link) => {
      const company = await getCompanyById(link.companyId);
      return { ...link, company };
    })
  );
  return enriched;
}

/**
 * Company sends an invite to a driver by their D-XXXXX code.
 * Creates a pending link record.
 */
export async function inviteDriverByCode(companyId: number, driverCode: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const driver = await getDriverProfileByCode(driverCode);
  if (!driver) throw new Error(`No driver found with code ${driverCode}`);

  // Check for existing link
  const existing = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driver.id),
        eq(driverCompanyLinks.companyId, companyId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const link = existing[0];
    if (link.status === "active") throw new Error("This driver is already connected to your company");
    if (link.status === "pending") throw new Error("An invitation is already pending for this driver");
    // Re-invite a removed/declined driver
    await db
      .update(driverCompanyLinks)
      .set({ status: "pending", invitedAt: new Date(), respondedAt: null })
      .where(eq(driverCompanyLinks.id, link.id));
    return { driverProfile: driver, linkId: link.id, isNew: false };
  }

  const result = await db.insert(driverCompanyLinks).values({
    driverProfileId: driver.id,
    companyId,
    status: "pending",
    invitedAt: new Date(),
  });

  return { driverProfile: driver, linkId: result[0].insertId, isNew: true };
}

/**
 * Driver responds to a pending invite.
 */
export async function respondToInvite(
  driverProfileId: number,
  linkId: number,
  accept: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const links = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.id, linkId),
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.status, "pending")
      )
    )
    .limit(1);

  if (links.length === 0) throw new Error("Invite not found or already responded");

  await db
    .update(driverCompanyLinks)
    .set({
      status: accept ? "active" : "declined",
      respondedAt: new Date(),
    })
    .where(eq(driverCompanyLinks.id, linkId));

  return { success: true, accepted: accept };
}

/**
 * Driver disconnects from a company.
 */
export async function driverDisconnect(driverProfileId: number, companyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(driverCompanyLinks)
    .set({ status: "removed", respondedAt: new Date() })
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.companyId, companyId),
        eq(driverCompanyLinks.status, "active")
      )
    );
}

/**
 * Company removes a driver from their roster.
 */
export async function companyRemoveDriver(companyId: number, driverProfileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(driverCompanyLinks)
    .set({ status: "removed", respondedAt: new Date() })
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.companyId, companyId),
        or(
          eq(driverCompanyLinks.status, "active"),
          eq(driverCompanyLinks.status, "pending")
        )
      )
    );
}

/**
 * Get all active drivers for a company (via driver_company_links).
 */
export async function getDriversByCompanyId(companyId: number) {
  const db = await getDb();
  if (!db) return [];

  const links = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.companyId, companyId),
        eq(driverCompanyLinks.status, "active")
      )
    );

  const drivers = await Promise.all(
    links.map(async (link) => {
      const profile = await getDriverProfileById(link.driverProfileId);
      return profile ? { ...profile, linkId: link.id } : null;
    })
  );
  return drivers.filter(Boolean);
}

/**
 * Legacy: remove driver from company (kept for backward compat with old routes).
 * Now delegates to companyRemoveDriver.
 */
export async function removeDriverFromCompany(driverProfileId: number, companyId: number) {
  return companyRemoveDriver(companyId, driverProfileId);
}

// ─── Invitation Helpers (legacy code-based system) ───────────────────────────

/** Generate a random 8-character uppercase alphanumeric invite code */
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createInvitation(
  companyId: number,
  driverName?: string,
  driverEmail?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let code = generateInviteCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db
      .select()
      .from(companyInvitations)
      .where(eq(companyInvitations.code, code))
      .limit(1);
    if (existing.length === 0) break;
    code = generateInviteCode();
    attempts++;
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await db.insert(companyInvitations).values({
    companyId,
    code,
    driverName: driverName ?? undefined,
    driverEmail: driverEmail ?? undefined,
    expiresAt,
  });

  const rows = await db
    .select()
    .from(companyInvitations)
    .where(eq(companyInvitations.id, result[0].insertId))
    .limit(1);
  return rows[0];
}

export async function getInvitationByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(companyInvitations)
    .where(eq(companyInvitations.code, code.toUpperCase()))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getInvitationsByCompanyId(companyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(companyInvitations).where(eq(companyInvitations.companyId, companyId));
}

export async function acceptInvitation(
  code: string,
  driverUserId: number,
  driverName: string,
  driverEmail?: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const invitation = await getInvitationByCode(code);
  if (!invitation) throw new Error("Invitation not found");
  if (invitation.status !== "pending") throw new Error(`Invitation is ${invitation.status}`);
  if (new Date() > invitation.expiresAt) {
    await db
      .update(companyInvitations)
      .set({ status: "expired" })
      .where(eq(companyInvitations.id, invitation.id));
    throw new Error("Invitation has expired");
  }

  // Get or create driver profile (generates D-XXXXX code on first use)
  const driverProfile = await getOrCreateDriverProfile(driverUserId, driverName, driverEmail);

  // Create an active link between driver and company
  const existingLink = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfile.id),
        eq(driverCompanyLinks.companyId, invitation.companyId)
      )
    )
    .limit(1);

  if (existingLink.length > 0 && existingLink[0].status !== "active") {
    await db
      .update(driverCompanyLinks)
      .set({ status: "active", respondedAt: new Date() })
      .where(eq(driverCompanyLinks.id, existingLink[0].id));
  } else if (existingLink.length === 0) {
    await db.insert(driverCompanyLinks).values({
      driverProfileId: driverProfile.id,
      companyId: invitation.companyId,
      status: "active",
      invitedAt: new Date(),
      respondedAt: new Date(),
    });
  }

  // Mark invitation as accepted
  await db
    .update(companyInvitations)
    .set({
      status: "accepted",
      acceptedByDriverId: driverProfile.id,
      acceptedAt: new Date(),
    })
    .where(eq(companyInvitations.id, invitation.id));

  return { driverProfile, invitation };
}

export async function revokeInvitation(invitationId: number, companyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(companyInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(companyInvitations.id, invitationId),
        eq(companyInvitations.companyId, companyId)
      )
    );
}

/**
 * Driver requests to join a company by C-XXXXX code.
 * Creates a pending driver_company_link if one doesn't already exist.
 * Returns { isNew: true } if a new link was created, { isNew: false } if already pending/active.
 */
export async function driverRequestJoin(
  driverProfileId: number,
  companyId: number
): Promise<{ isNew: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check for an existing link
  const existing = await db
    .select()
    .from(driverCompanyLinks)
    .where(
      and(
        eq(driverCompanyLinks.driverProfileId, driverProfileId),
        eq(driverCompanyLinks.companyId, companyId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const link = existing[0];
    if (link.status === "active") {
      throw new Error("You are already connected to this company.");
    }
    if (link.status === "pending") {
      throw new Error("You already have a pending request with this company.");
    }
    // If previously declined or removed, re-create as pending
    await db
      .update(driverCompanyLinks)
      .set({ status: "pending", invitedAt: new Date(), respondedAt: null })
      .where(eq(driverCompanyLinks.id, link.id));
    return { isNew: false };
  }

  // Create a new pending link (driver-initiated, so invitedAt = now)
  await db.insert(driverCompanyLinks).values({
    driverProfileId,
    companyId,
    status: "pending",
    invitedAt: new Date(),
  });
  return { isNew: true };
}

// ─── Load Expenses ────────────────────────────────────────────────────────────

export async function createExpense(data: InsertLoadExpense): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(loadExpenses).values(data);
  return (result as any).insertId as number;
}

export async function getExpensesByLoad(loadId: string): Promise<typeof loadExpenses.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loadExpenses).where(eq(loadExpenses.loadId, loadId));
}

export async function getExpensesByDriver(driverCode: string): Promise<typeof loadExpenses.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loadExpenses).where(eq(loadExpenses.driverCode, driverCode));
}

export async function deleteExpense(id: number, driverCode: string): Promise<{ receiptKey: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(loadExpenses)
    .where(and(eq(loadExpenses.id, id), eq(loadExpenses.driverCode, driverCode)));
  if (!rows.length) throw new Error("Expense not found or not owned by driver");
  const receiptKey = rows[0].receiptKey ?? null;
  await db.delete(loadExpenses).where(eq(loadExpenses.id, id));
  return { receiptKey };
}

// ─── Gate Pass Helpers ────────────────────────────────────────────────────────

export async function getGatePass(loadId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(gatePassFiles).where(eq(gatePassFiles.loadId, loadId));
  return rows[0] ?? null;
}

export async function upsertGatePass(data: InsertGatePassFile): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete any existing gate pass for this load first (one per load)
  await db.delete(gatePassFiles).where(eq(gatePassFiles.loadId, data.loadId));
  const result = await db.insert(gatePassFiles).values(data);
  return (result as any).insertId as number;
}

export async function deleteGatePass(loadId: string, companyCode: string): Promise<{ fileKey: string } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(gatePassFiles)
    .where(and(eq(gatePassFiles.loadId, loadId), eq(gatePassFiles.companyCode, companyCode)));
  if (!rows.length) return null;
  const fileKey = rows[0].fileKey;
  await db.delete(gatePassFiles).where(eq(gatePassFiles.loadId, loadId));
  return { fileKey };
}

// ─── Load Signature Helpers ───────────────────────────────────────────────────

/**
 * Save a pickup or delivery signature record.
 * Replaces any existing signature of the same type for the same load+driver.
 */
export async function saveLoadSignature(data: InsertLoadSignature): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete any previous signature of the same type for this load+driver
  await db
    .delete(loadSignatures)
    .where(
      and(
        eq(loadSignatures.loadId, data.loadId),
        eq(loadSignatures.driverCode, data.driverCode),
        eq(loadSignatures.signatureType, data.signatureType)
      )
    );
  const result = await db.insert(loadSignatures).values(data);
  return (result as any)[0].insertId as number;
}

/**
 * Get all signatures for a load (both pickup and delivery).
 */
export async function getSignaturesForLoad(loadId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loadSignatures).where(eq(loadSignatures.loadId, loadId));
}

// ─── Driver Location Helpers ─────────────────────────────────────────────────

export async function insertDriverLocationPings(
  driverCode: string,
  pings: Array<{
    lat: number;
    lng: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
    timestamp: number;
  }>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows: InsertDriverLocation[] = pings.map((p) => ({
    driverCode,
    latitude: String(p.lat),
    longitude: String(p.lng),
    accuracy: p.accuracy != null ? String(p.accuracy) : undefined,
    speed: p.speed != null ? String(p.speed) : undefined,
    heading: p.heading != null ? String(p.heading) : undefined,
    deviceTimestamp: p.timestamp,
  }));

  await db.insert(driverLocations).values(rows);
}

export async function getLatestDriverLocations(companyId?: number) {
  const db = await getDb();
  if (!db) return [];

  // If companyId is given, only return locations for drivers linked to that company
  if (companyId) {
    const linked = await db
      .select({ driverCode: driverProfiles.driverCode, platformDriverCode: driverProfiles.platformDriverCode, name: driverProfiles.name })
      .from(driverProfiles)
      .innerJoin(driverCompanyLinks, eq(driverProfiles.id, driverCompanyLinks.driverProfileId))
      .where(and(eq(driverCompanyLinks.companyId, companyId), eq(driverCompanyLinks.status, "active")));

    if (linked.length === 0) return [];

    const codes = linked
      .flatMap((d) => [d.driverCode, d.platformDriverCode].filter(Boolean))
      .filter((c): c is string => !!c);

    if (codes.length === 0) return [];

    // Get latest ping per driver code using a subquery approach
    const results = [];
    for (const code of codes) {
      const rows = await db
        .select()
        .from(driverLocations)
        .where(eq(driverLocations.driverCode, code))
        .orderBy(driverLocations.createdAt)
        .limit(1);
      if (rows.length > 0) {
        const driver = linked.find((d) => d.driverCode === code || d.platformDriverCode === code);
        results.push({ ...rows[0], driverName: driver?.name ?? code });
      }
    }
    return results;
  }

  return db.select().from(driverLocations).orderBy(driverLocations.createdAt).limit(50);
}
