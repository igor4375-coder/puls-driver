import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { sendPushNotification } from "./push";
import * as companyPlatform from "./company-platform-client";
import * as phoneAuth from "./phone-auth";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Company Routes (dispatcher side) ──────────────────────────────────────
  company: router({
    /** Get or create the current user's company profile */
    getMyCompany: protectedProcedure.query(async ({ ctx }) => {
      return db.getCompanyByOwnerId(ctx.user.id);
    }),

    /** Create/initialize a company for the current user (generates C-XXXXX code) */
    setupCompany: protectedProcedure
      .input(
        z.object({
          name: z.string().min(2).max(255),
          email: z.string().email().optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          dotNumber: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return db.getOrCreateCompany(ctx.user.id, input.name, input.email);
      }),

    /** Get all active drivers in the company's fleet (via driver_company_links) */
    getDrivers: protectedProcedure.query(async ({ ctx }) => {
      const company = await db.getCompanyByOwnerId(ctx.user.id);
      if (!company) return [];
      return db.getDriversByCompanyId(company.id);
    }),

    /**
     * Invite a driver to the company by their D-XXXXX code.
     * Creates a pending link; driver must accept in their app.
     */
    inviteDriverByCode: protectedProcedure
      .input(z.object({ driverCode: z.string().min(7).max(8) }))
      .mutation(async ({ ctx, input }) => {
        const company = await db.getCompanyByOwnerId(ctx.user.id);
        if (!company) throw new Error("You must set up your company profile first");
        const result = await db.inviteDriverByCode(company.id, input.driverCode);
        if (result.isNew && result.driverProfile.pushToken && result.driverProfile.notifyNewInvite !== false) {
          sendPushNotification(
            result.driverProfile.pushToken,
            "New Company Invite",
            `${company.name} has invited you to join their fleet. Tap to review.`,
            { type: "invite", companyId: company.id, companyName: company.name },
            "invites"
          ).catch(() => {});
        }
        return {
          success: true,
          driverName: result.driverProfile.name,
          driverCode: result.driverProfile.driverCode,
          isNew: result.isNew,
        };
      }),

    /** Remove a driver from the company fleet */
    removeDriver: protectedProcedure
      .input(z.object({ driverProfileId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const company = await db.getCompanyByOwnerId(ctx.user.id);
        if (!company) throw new Error("Company not found");
        await db.companyRemoveDriver(company.id, input.driverProfileId);
        return { success: true };
      }),

    /** Generate a legacy invitation code for a new driver (backward compat) */
    generateInvitation: protectedProcedure
      .input(
        z.object({
          driverName: z.string().min(1).max(255).optional(),
          driverEmail: z.string().email().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const company = await db.getCompanyByOwnerId(ctx.user.id);
        if (!company) throw new Error("You must set up your company profile first");
        return db.createInvitation(company.id, input.driverName, input.driverEmail);
      }),

    /** Get all legacy invitations sent by this company */
    getInvitations: protectedProcedure.query(async ({ ctx }) => {
      const company = await db.getCompanyByOwnerId(ctx.user.id);
      if (!company) return [];
      return db.getInvitationsByCompanyId(company.id);
    }),

    /** Revoke a pending legacy invitation */
    revokeInvitation: protectedProcedure
      .input(z.object({ invitationId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const company = await db.getCompanyByOwnerId(ctx.user.id);
        if (!company) throw new Error("Company not found");
        await db.revokeInvitation(input.invitationId, company.id);
        return { success: true };
      }),
  }),

  // ─── Driver Routes (driver app side) ───────────────────────────────────────
  driver: router({
    /**
     * Get or create the current driver's profile.
     * On first call, generates a permanent D-XXXXX code for the driver.
     */
    getMyProfile: protectedProcedure.query(async ({ ctx }) => {
      const profile = await db.getOrCreateDriverProfile(
        ctx.user.id,
        ctx.user.name ?? "Driver",
        ctx.user.email
      );
      return profile;
    }),

    /** Get all active company connections for the current driver */
    getMyConnections: protectedProcedure.query(async ({ ctx }) => {
      const profile = await db.getDriverProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.getDriverConnections(profile.id);
    }),

    /**
     * Get all active company connections by driver code.
     * Public endpoint used by phone-auth drivers who don't have a server session.
     */
    getMyConnectionsByCode: publicProcedure
      .input(z.object({ driverCode: z.string().regex(/^D-\d{5}$/) }))
      .query(async ({ input }) => {
        const profile = await db.getDriverProfileByCode(input.driverCode);
        if (!profile) return [];
        return db.getDriverConnections(profile.id);
      }),

    /**
     * Get driver profile by local driverCode.
     * Public endpoint used by phone-auth drivers to fetch their latest platformDriverCode.
     */
    getProfileByCode: publicProcedure
      .input(z.object({ driverCode: z.string().regex(/^D-\d{5}$/) }))
      .query(async ({ input }) => {
        const profile = await db.getDriverProfileByCode(input.driverCode);
        if (!profile) return null;
        return {
          driverCode: profile.driverCode,
          platformDriverCode: profile.platformDriverCode ?? null,
          name: profile.name,
          phone: profile.phone,
          truckNumber: profile.truckNumber ?? null,
          trailerNumber: profile.trailerNumber ?? null,
          equipmentType: profile.equipmentType ?? null,
          equipmentCapacity: profile.equipmentCapacity ?? null,
          notifyNewLoad: profile.notifyNewLoad ?? true,
          notifyNewInvite: profile.notifyNewInvite ?? true,
          notifyGatePassExpiry: profile.notifyGatePassExpiry ?? true,
          notifyStorageExpiry: profile.notifyStorageExpiry ?? true,
        };
      }),

    /** Update profile fields for phone-auth drivers (no session required) */
    updateProfileByCode: publicProcedure
      .input(z.object({
        driverCode: z.string().regex(/^D-\d{5}$/),
        truckNumber: z.string().optional(),
        trailerNumber: z.string().optional(),
        equipmentType: z.enum(["tow_truck", "flatbed", "stinger", "seven_car_carrier"]).nullable().optional(),
        equipmentCapacity: z.number().int().min(1).max(10).nullable().optional(),
        notifyNewLoad: z.boolean().optional(),
        notifyNewInvite: z.boolean().optional(),
        notifyGatePassExpiry: z.boolean().optional(),
        notifyStorageExpiry: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { driverCode, ...fields } = input;
        const profile = await db.getDriverProfileByCode(driverCode);
        if (!profile) throw new Error("Driver profile not found");
        await db.updateDriverProfile(profile.id, fields);
        return { success: true };
      }),

    /** Get all pending invites for the current driver */
    getMyPendingInvites: protectedProcedure.query(async ({ ctx }) => {
      const profile = await db.getDriverProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.getDriverPendingInvites(profile.id);
    }),

    /** Accept or decline a pending invite */
    respondToInvite: protectedProcedure
      .input(z.object({ linkId: z.number(), accept: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getDriverProfileByUserId(ctx.user.id);
        if (!profile) throw new Error("Driver profile not found");
        return db.respondToInvite(profile.id, input.linkId, input.accept);
      }),

    /** Driver disconnects from a company */
    disconnectFromCompany: protectedProcedure
      .input(z.object({ companyId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getDriverProfileByUserId(ctx.user.id);
        if (!profile) throw new Error("Driver profile not found");
        await db.driverDisconnect(profile.id, input.companyId);
        return { success: true };
      }),

    /**
     * Driver disconnects from a company by driver code.
     * Public endpoint for phone-auth drivers who don't have a server session.
     */
    disconnectFromCompanyByCode: publicProcedure
      .input(z.object({ driverCode: z.string().regex(/^D-\d{5}$/), companyId: z.number() }))
      .mutation(async ({ input }) => {
        const profile = await db.getDriverProfileByCode(input.driverCode);
        if (!profile) throw new Error("Driver profile not found");
        await db.driverDisconnect(profile.id, input.companyId);
        return { success: true };
      }),

    /**
     * Sync a company connection from the platform into the local DB.
     * Used as a fallback when invite acceptance failed to create local records,
     * and also called on app startup to ensure My Companies is always populated.
     */
    syncCompanyFromPlatform: publicProcedure
      .input(
        z.object({
          driverCode: z.string().regex(/^D-\d{5}$/),
          companyCode: z.string().optional(),
          companyName: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        // Try local code first, then platform code
        let profile = await db.getDriverProfileByCode(input.driverCode);
        if (!profile) {
          profile = await db.getDriverProfileByPlatformCode(input.driverCode);
        }
        if (!profile) throw new Error(`Driver profile not found for code: ${input.driverCode}`);
        await db.acceptPlatformInvite(
          profile.id,
          input.companyCode ?? "",
          input.companyName
        );
        console.log(`[driver.syncCompanyFromPlatform] Synced company "${input.companyName}" for driver ${input.driverCode}`);
        return { success: true };
      }),

    /** Update driver profile fields (phone, truck number, etc.) */
    updateProfile: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255).optional(),
          phone: z.string().optional(),
          licenseNumber: z.string().optional(),
          truckNumber: z.string().optional(),
          trailerNumber: z.string().optional(),
          pushToken: z.string().optional(),
          equipmentType: z.enum(["tow_truck", "flatbed", "stinger", "seven_car_carrier"]).nullable().optional(),
          equipmentCapacity: z.number().int().min(1).max(10).nullable().optional(),
          notifyNewLoad: z.boolean().optional(),
          notifyNewInvite: z.boolean().optional(),
          notifyGatePassExpiry: z.boolean().optional(),
          notifyStorageExpiry: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getDriverProfileByUserId(ctx.user.id);
        if (!profile) throw new Error("Driver profile not found");
        await db.updateDriverProfile(profile.id, input);
        return { success: true };
      }),

    /** Look up an invitation by legacy code — returns company preview without accepting */
    previewInvitation: publicProcedure
      .input(z.object({ code: z.string().min(4).max(16) }))
      .query(async ({ input }) => {
        const invitation = await db.getInvitationByCode(input.code);
        if (!invitation) throw new Error("Invitation not found. Please check the code and try again.");
        if (invitation.status === "accepted") throw new Error("This invitation has already been used.");
        if (invitation.status === "revoked") throw new Error("This invitation has been revoked by the company.");
        if (invitation.status === "expired" || new Date() > invitation.expiresAt) {
          throw new Error("This invitation has expired. Ask your dispatcher to send a new one.");
        }

        const company = await db.getCompanyById(invitation.companyId);
        if (!company) throw new Error("Company not found");

        return {
          code: invitation.code,
          companyName: company.name,
          companyCode: company.companyCode,
          companyEmail: company.email,
          companyPhone: company.phone,
          driverName: invitation.driverName,
          driverEmail: invitation.driverEmail,
          expiresAt: invitation.expiresAt,
        };
      }),

    /**
     * Look up a company by its C-XXXXX code — returns company preview without joining.
     * Used by the driver to preview the company before sending a join request.
     */
    lookupCompanyByCode: publicProcedure
      .input(z.object({ companyCode: z.string().min(7).max(8) }))
      .query(async ({ input }) => {
        const company = await db.getCompanyByCode(input.companyCode);
        if (!company) throw new Error("Company not found. Please check the Company ID and try again.");
        return {
          id: company.id,
          name: company.name,
          companyCode: company.companyCode,
          email: company.email,
          phone: company.phone,
        };
      }),

    /**
     * Driver requests to join a company by C-XXXXX code.
     * Creates a pending driver_company_link that the company must approve.
     */
    requestJoinByCompanyCode: protectedProcedure
      .input(z.object({ companyCode: z.string().min(7).max(8) }))
      .mutation(async ({ ctx, input }) => {
        const company = await db.getCompanyByCode(input.companyCode);
        if (!company) throw new Error("Company not found.");
        const profile = await db.getOrCreateDriverProfile(
          ctx.user.id,
          ctx.user.name ?? "Driver",
          ctx.user.email
        );
        const result = await db.driverRequestJoin(profile.id, company.id);
        return {
          success: true,
          companyName: company.name,
          isNew: result.isNew,
        };
      }),

    /** Accept a legacy invitation and join the company */
    acceptInvitation: protectedProcedure
      .input(z.object({ code: z.string().min(4).max(16) }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.acceptInvitation(
          input.code,
          ctx.user.id,
          ctx.user.name ?? "Driver",
          ctx.user.email
        );
        const company = await db.getCompanyById(result.invitation.companyId);
        return {
          success: true,
          companyName: company?.name ?? "Your Company",
          companyCode: company?.companyCode,
          driverProfile: result.driverProfile,
        };
      }),
  }),

  // ─── Photos: inspection photo upload to S3 ────────────────────────────────
  photos: router({
    /**
     * Burn a GPS/timestamp evidence stamp onto a photo.
     * Client sends base64 image + stamp text lines; server uses Sharp to composite
     * the banner at full resolution and returns the stamped base64.
     * This avoids the ViewShot off-screen rendering limitation on device.
     */
    stampPhoto: publicProcedure
      .input(
        z.object({
          base64: z.string().min(1),
          mimeType: z.string().default("image/jpeg"),
          line1: z.string().optional(),
          line2: z.string().optional(),
          inspectionType: z.string().optional(),
          driverCode: z.string().optional(),
          companyName: z.string().optional(),
          vin: z.string().optional(),
          locationLabel: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { stampPhotoBuffer } = await import("./photo-stamp-server.js");
        const inputBuffer = Buffer.from(input.base64, "base64");

        let line1 = input.line1 ?? "";
        let line2 = input.line2 ?? "";

        if (input.inspectionType || input.driverCode) {
          const now = new Date();
          const dateStr = now.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
          const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
          const inspType = input.inspectionType ?? "Inspection";
          const locPart = input.locationLabel
            ?? (input.lat && input.lng ? `${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}` : "");
          line1 = locPart
            ? `${inspType}: ${dateStr}  ${timeStr}, ${locPart}`
            : `${inspType}: ${dateStr}  ${timeStr}`;
          const parts = [
            input.driverCode ? `Driver: ${input.driverCode}` : "",
            input.vin ? `VIN: ${input.vin}` : "",
            input.companyName ?? "Puls Dispatch",
          ].filter(Boolean);
          line2 = parts.join("  ·  ");
        }

        const stamped = await stampPhotoBuffer(inputBuffer, { line1, line2 });
        return { base64: stamped.toString("base64"), mimeType: "image/jpeg" };
      }),

    /**
     * Upload a single inspection photo.
     * Client sends base64-encoded image data; server stores it in S3 and returns the public URL.
     */
    upload: publicProcedure
      .input(
        z.object({
          base64: z.string().min(1),
          mimeType: z.string().default("image/jpeg"),
          groupKey: z.string().optional(),
          clientId: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const suffix = Math.random().toString(36).slice(2, 10);
        const group = input.groupKey ? `${input.groupKey}/` : "inspections/";
        const key = `${group}${suffix}.${ext}`;

        const buffer = Buffer.from(input.base64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);

        return { url, key, clientId: input.clientId };
      }),
  }),

  // ─── Push Token Sync: ensures Railway MySQL has the driver's push token ─────
  push: router({
    syncToken: publicProcedure
      .input(z.object({
        driverCode: z.string().min(5).max(10),
        pushToken: z.string().min(10),
        platformDriverCode: z.string().optional(),
        name: z.string().optional(),
        phone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertDriverPushToken(input.driverCode, input.pushToken, {
          platformDriverCode: input.platformDriverCode,
          name: input.name,
          phone: input.phone,
        });
        companyPlatform.registerPushToken(input.driverCode, input.pushToken).catch(() => {});
        return { success: true };
      }),
  }),

  // ─── Loads: company platform integration ────────────────────────────────────
  loads: router({
    /**
     * Fetch loads assigned to the current driver from the company platform.
     * Falls back to empty array if driver not found or API unavailable.
     */
    getAssigned: publicProcedure
      .input(z.object({ driverCode: z.string().min(7).max(8) }))
      .query(async ({ input }) => {
        try {
          const platformLoads = await companyPlatform.getAssignedLoads(input.driverCode);
          // Transform company platform load shape to driver app Load shape
          return platformLoads.map((pl) => ({
            // legId is the per-leg unique identifier (preferred); tripId is legacy fallback
            legId: (pl as any).legId ?? pl.tripId,
            tripId: pl.tripId,
            loadNumber: pl.loadNumber,
            vehicleCount: pl.vehicleCount,
            // Pass through full location objects — spread to preserve any extra fields
            // (phone, contactName, phoneNumber, etc.) that the platform may send
            pickupLocation: { ...(pl.pickupLocation as any) },
            deliveryLocation: { ...(pl.deliveryLocation as any) },
            pickupDate: pl.pickupDate,
            deliveryDate: pl.deliveryDate,
            rate: pl.rate,
            // Spread vehicle to preserve all fields including hasKeys, starts, drives from platform
            vehicle: pl.vehicle ? { ...(pl.vehicle as any) } : null,
            status: pl.status,
            // Gate pass fields — must be explicitly passed through or they are silently dropped
            gatePassUrl: pl.gatePassUrl ?? null,
            storageExpiryDate: pl.storageExpiryDate ?? null,
          }));
        } catch (err) {
          console.error("[loads.getAssigned] Company platform error:", err);
          return [];
        }
      }),

    /**
     * Submit an inspection report (pickup or delivery) to the company platform.
     * Sends S3 photo URLs and damage data.
     */
    syncInspection: publicProcedure
      .input(
        z.object({
          loadNumber: z.string(),
          legId: z.number(),
          driverCode: z.string(),
          inspectionType: z.enum(["pickup", "delivery"]),
          vehicleVin: z.string(),
          photos: z.array(z.string()),
          damages: z.array(
            z.object({
              id: z.string(),
              zone: z.string(),
              type: z.string(),
              severity: z.enum(["minor", "moderate", "severe"]),
              x: z.number(),
              y: z.number(),
              diagramView: z.string().optional(),
              note: z.string().optional(),
            })
          ),
          noDamage: z.boolean(),
          gps: z.object({ lat: z.number(), lng: z.number() }),
          timestamp: z.string(),
          notes: z.string().optional(),
          handoffNote: z.string().optional(),
          additionalInspection: z.object({
            odometer: z.string().optional(),
            drivable: z.boolean().optional(),
            windscreen: z.boolean().optional(),
            glassesIntact: z.boolean().optional(),
            titlePresent: z.boolean().optional(),
            billOfSale: z.boolean().optional(),
            keys: z.number().optional(),
            remotes: z.number().optional(),
            headrests: z.number().optional(),
            cargoCover: z.boolean().optional(),
            spareTire: z.boolean().optional(),
            radio: z.boolean().optional(),
            manuals: z.boolean().optional(),
            navigationDisk: z.boolean().optional(),
            pluginChargerCable: z.boolean().optional(),
            headphones: z.boolean().optional(),
          }).optional(),
        })
      )
      .mutation(async ({ input }) => {
        console.log("[syncInspection] received:", JSON.stringify({
          loadNumber: input.loadNumber,
          legId: input.legId,
          driverCode: input.driverCode,
          inspectionType: input.inspectionType,
          vehicleVin: input.vehicleVin,
          photosCount: input.photos.length,
          damagesCount: input.damages.length,
          noDamage: input.noDamage,
          hasAdditionalInspection: !!input.additionalInspection,
        }));
        return companyPlatform.syncInspection(input);
      }),

    /**
     * Update trip status (picked_up or delivered) on the company platform.
     */
    updateStatus: publicProcedure
      .input(
        z.object({
          tripId: z.number(),
          driverCode: z.string(),
          status: z.enum(["picked_up", "delivered"]),
        })
      )
      .mutation(async ({ input }) => {
        return companyPlatform.updateTripStatus(input);
      }),

    /**
     * Mark a vehicle as picked up on the company platform.
     * Requires mandatory inspection photos (S3 URLs), GPS coordinates, and pickup time.
     */
    markAsPickedUp: publicProcedure
      .input(
        z.object({
          loadNumber: z.string().min(1),
          legId: z.number().int(),
          driverCode: z.string().min(1),
          pickupTime: z.string().min(1), // ISO 8601
          pickupGPS: z.object({
            lat: z.number(),
            lng: z.number(),
          }),
          pickupPhotos: z.array(z.string()).optional().default([]),
        })
      )
      .mutation(async ({ input }) => {
        console.log("[markAsPickedUp] received:", JSON.stringify({ loadNumber: input.loadNumber, legId: input.legId, driverCode: input.driverCode, photosCount: input.pickupPhotos?.length ?? 0 }));
        return companyPlatform.markAsPickedUp(input);
      }),

    /**
     * Mark a vehicle as delivered on the company platform.
     * Requires delivery time, GPS coordinates, and optional delivery photos.
     */
    markAsDelivered: publicProcedure
      .input(
        z.object({
          loadNumber: z.string().min(1),
          legId: z.number().int(),
          driverCode: z.string().min(1),
          deliveryTime: z.string().min(1), // ISO 8601
          deliveryGPS: z.object({
            lat: z.number(),
            lng: z.number(),
          }),
          deliveryPhotos: z.array(z.string()).optional().default([]),
        })
      )
      .mutation(async ({ input }) => {
        console.log("[markAsDelivered] received:", JSON.stringify({
          loadNumber: input.loadNumber,
          legId: input.legId,
          driverCode: input.driverCode,
          photosCount: input.deliveryPhotos?.length ?? 0,
        }));
        return companyPlatform.markAsDelivered(input);
      }),

    /**
     * Revert a vehicle from picked_up back to assigned on the company platform.
     * Called when the driver moves a load back to Pending in the driver app.
     */
    revertPickup: publicProcedure
      .input(
        z.object({
          loadNumber: z.string().min(1),
          legId: z.number().int(),
          driverCode: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
         return companyPlatform.revertPickup({
          loadId: input.loadNumber,
          legId: input.legId,
          driverCode: input.driverCode,
        });
      }),
    /**
     * Save a pickup or delivery signature for a load.
     * Stores customerSig, driverSig, and customerNotAvailable flag in the DB.
     */
    saveSignature: publicProcedure
      .input(
        z.object({
          loadId: z.string().min(1),
          driverCode: z.string().min(1),
          signatureType: z.enum(["pickup", "delivery"]),
          customerName: z.string().optional(),
          customerSig: z.string().optional(),
          driverSig: z.string().optional(),
          customerNotAvailable: z.boolean().default(false),
          capturedAt: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const id = await db.saveLoadSignature({
          loadId: input.loadId,
          driverCode: input.driverCode,
          signatureType: input.signatureType,
          customerName: input.customerName ?? null,
          customerSig: input.customerSig ?? null,
          driverSig: input.driverSig ?? null,
          customerNotAvailable: input.customerNotAvailable,
          capturedAt: input.capturedAt,
        });
        return { success: true, id };
      }),
    /**
     * Get all signatures for a load (pickup + delivery).
     */
    getSignatures: publicProcedure
      .input(z.object({ loadId: z.string().min(1) }))
      .query(async ({ input }) => {
        return db.getSignaturesForLoad(input.loadId);
      }),
  }),
  // ─── Phone Auth: phone-number-based identity (one permanent ID per phone) ─────
  phoneAuth: router({
    /**
     * Step 1: Initiate phone verification.
     * Option B (current): generates a 6-digit code and returns it directly.
     * Option A (Twilio): sends an SMS and returns isExistingUser only.
     *
     * UPGRADE: replace this with Twilio Verify API call in server/phone-auth.ts
     */
    sendCode: publicProcedure
      .input(
        z.object({
          phoneNumber: z.string().min(7).max(20),
        })
      )
      .mutation(async ({ input }) => {
        const result = await phoneAuth.sendVerification(input.phoneNumber);
        return {
          isExistingUser: result.isExistingUser,
          // Option B: return code directly so frontend can display it
          // Option A: this field will be empty (code sent via SMS)
          code: result.code,
          expiresAt: result.expiresAt,
        };
      }),

    /**
     * Step 2: Verify the 6-digit code and get/create a driver profile.
     * Returns the driver's D-XXXXX code and name so the app can log them in.
     */
    verifyCode: publicProcedure
      .input(
        z.object({
          phoneNumber: z.string().min(7).max(20),
          code: z.string().length(6),
          name: z.string().min(1).max(255).optional(),
          deviceFingerprint: z.string().max(128).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const verified = await phoneAuth.checkVerification(input.phoneNumber, input.code);
        if (!verified.success) {
          throw new Error("Invalid or expired verification code. Please try again.");
        }

        const normalizedPhone = verified.phoneNumber;

        // Upsert the user row using phone number as the stable openId
        const openId = `phone:${normalizedPhone}`;
        await db.upsertUser({
          openId,
          name: input.name ?? "Driver",
          loginMethod: "phone",
          lastSignedIn: new Date(),
        });

        const user = await db.getUserByOpenId(openId);
        if (!user) throw new Error("Failed to create user account");

        // Get or create the driver profile (generates D-XXXXX on first call)
        const profile = await db.getOrCreateDriverProfile(
          user.id,
          input.name ?? "Driver",
          undefined
        );

        // Update the phone number on the driver profile
        await db.updateDriverProfile(profile.id, { phone: normalizedPhone, phoneVerified: true });

        // Bind phone → driver profile in phone_auth_sessions
        await phoneAuth.bindPhoneToDriver(
          normalizedPhone,
          profile.id,
          user.id,
          input.deviceFingerprint
        );

        // Register with the dispatcher platform to get the platform driver ID.
        // This runs server-side so it can be retried reliably and the result
        // is persisted to the DB (survives app reinstalls / device changes).
        let platformDriverCode = profile.platformDriverCode ?? null;
        if (!platformDriverCode) {
          try {
            const platformId = await companyPlatform.registerDriver(
              profile.name,
              normalizedPhone,
              profile.driverCode ?? undefined  // pass local D-XXXXX so platform stores it as mobileAppDriverCode
            );
            if (platformId) {
              platformDriverCode = platformId;
              await db.updateDriverProfile(profile.id, { platformDriverCode: platformId });
            }
          } catch (e) {
            // Non-fatal: platform may be sleeping. Driver can sync later.
            console.warn("[Platform] Registration failed during verifyCode:", e);
          }
        }

        return {
          driverCode: profile.driverCode,
          platformDriverCode: platformDriverCode ?? undefined,
          name: profile.name,
          phoneNumber: normalizedPhone,
          isExistingUser: verified.isExistingUser,
        };
      }),

    /**
     * Retry platform registration for a driver who is missing a platformDriverCode.
     * Called by the "Get Invite Code" button on the Profile screen.
     * Looks up the driver by their local driverCode, attempts platform registration,
     * saves the result to the DB, and returns the new platformDriverCode.
     */
    syncPlatformCode: publicProcedure
      .input(z.object({ driverCode: z.string().min(5).max(10) }))
      .mutation(async ({ input }) => {
        const profile = await db.getDriverProfileByCode(input.driverCode);
        if (!profile) throw new Error("Driver not found");

        // If already registered, just return the existing code
        if (profile.platformDriverCode) {
          return { platformDriverCode: profile.platformDriverCode };
        }

        const platformId = await companyPlatform.registerDriver(
          profile.name,
          profile.phone ?? "",
          profile.driverCode ?? undefined  // pass local D-XXXXX so platform stores it as mobileAppDriverCode
        );

        if (!platformId) {
          throw new Error(
            "Platform is currently unavailable. Please try again in a few minutes."
          );
        }

        await db.updateDriverProfile(profile.id, { platformDriverCode: platformId });
        return { platformDriverCode: platformId };
      }),

    /**
     * Save the driver's Expo push token to the company platform.
     * Called by the mobile app after push notification permission is granted.
     * The platform stores this token and uses it to send push notifications
     * when a load is assigned to the driver.
     */
    savePushTokenToPlatform: publicProcedure
      .input(z.object({
        driverCode: z.string().min(5).max(10),
        pushToken: z.string().min(10),
      }))
      .mutation(async ({ input }) => {
        // Also save to our own DB for redundancy
        const profile = await db.getDriverProfileByCode(input.driverCode);
        if (profile) {
          await db.updateDriverProfile(profile.id, { pushToken: input.pushToken });
        }
        // Forward to company platform
        const success = await companyPlatform.registerPushToken(input.driverCode, input.pushToken);
        return { success };
      }),
  }),

  // ─── Demo: public endpoint to get/create a real D-XXXXX code for demo mode ──
  demo: router({
    /**
     * Get or create a real, persistent D-XXXXX driver code for a demo device.
     * Uses a deviceId (UUID stored in AsyncStorage) as the unique key.
     * This allows demo users to test load assignments from the company platform
     * without needing a full Manus account.
     *
     * The deviceId is stored as the user's openId with a "demo-device:" prefix
     * so it reuses the existing users + driverProfiles tables with no schema changes.
     */
    getOrCreateProfile: publicProcedure
      .input(
        z.object({
          deviceId: z.string().min(8).max(128),
          name: z.string().min(1).max(255).default("Demo Driver"),
        })
      )
      .mutation(async ({ input }) => {
        const openId = `demo-device:${input.deviceId}`;

        // Upsert the demo user row
        await db.upsertUser({
          openId,
          name: input.name,
          loginMethod: "demo",
          lastSignedIn: new Date(),
        });

        // Get the user row to get the numeric id
        const user = await db.getUserByOpenId(openId);
        if (!user) throw new Error("Failed to create demo user");

        // Get or create the driver profile (generates D-XXXXX on first call)
        const profile = await db.getOrCreateDriverProfile(user.id, input.name, undefined);

        return {
          driverCode: profile.driverCode,
          name: profile.name,
        };
      }),
  }),

  // ─── Platform Invites: driver-facing invite flow via company platform API ────
  invites: router({
    /**
     * Fetch all pending company invitations for a driver by their D-XXXXX code.
     * Proxies to the company platform's driversApi.getPendingInvites endpoint.
     */
    getPending: publicProcedure
      .input(z.object({ driverCode: z.string().regex(/^D-\d{5}$/) }))
      .query(async ({ input }) => {
        try {
          return await companyPlatform.getPendingInvites(input.driverCode);
        } catch (err) {
          console.error("[invites.getPending] Company platform error:", err);
          return [];
        }
      }),

    /**
     * Accept or decline a company invitation.
     * When accepted, the driver appears as Active in the company's Connected Drivers list
     * AND a local driver_company_links record is created so the My Companies section works.
     */
    respond: publicProcedure
      .input(
        z.object({
          inviteId: z.number(),
          accept: z.boolean(),
          /** Platform-assigned driver code (e.g. D-18589) — sent to the platform API */
          driverCode: z.string().regex(/^D-\d{5}$/),
          /** Local mobile-app driver code (e.g. D-97071) — used to find the local driver profile */
          localDriverCode: z.string().regex(/^D-\d{5}$/).optional(),
          /** Company code from the invite (e.g. C-12345) — stored locally */
          companyCode: z.string().optional(),
          /** Company name from the invite — stored locally */
          companyName: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        // 1. Respond to the invite on the platform
        const result = await companyPlatform.respondToInvite({
          inviteId: input.inviteId,
          accept: input.accept,
          driverCode: input.driverCode,
        });

        // 2. If accepted, also store the connection locally so My Companies section works.
        // Try localDriverCode first (local D-XXXXX), then fall back to platformDriverCode (platform D-XXXXX).
        if (input.accept && input.companyName) {
          try {
            // Try local code first, then platform code
            let driverProfile = input.localDriverCode
              ? await db.getDriverProfileByCode(input.localDriverCode)
              : undefined;
            if (!driverProfile) {
              // Fall back: look up by platformDriverCode stored in DB
              driverProfile = await db.getDriverProfileByPlatformCode(input.driverCode);
            }
            if (driverProfile) {
              await db.acceptPlatformInvite(
                driverProfile.id,
                input.companyCode ?? "",
                input.companyName
              );
            } else {
              console.warn("[invites.respond] Could not find driver profile for codes:", input.localDriverCode, input.driverCode);
            }
          } catch (err) {
            // Non-fatal: log but don't fail the whole mutation
            console.error("[invites.respond] Failed to store local company connection:", err);
          }
        }

        return result;
      }),
  }),

  // ─── Public: look up invite code details (no auth needed) ──────────────────
  invitations: router({
    preview: publicProcedure
      .input(z.object({ code: z.string().min(4).max(16) }))
      .query(async ({ input }) => {
        const invitation = await db.getInvitationByCode(input.code);
        if (!invitation) throw new Error("Invitation not found");
        if (invitation.status !== "pending") throw new Error(`Invitation is ${invitation.status}`);
        if (new Date() > invitation.expiresAt) throw new Error("Invitation has expired");

        const company = await db.getCompanyById(invitation.companyId);
        return {
          code: invitation.code,
          companyName: company?.name ?? "Unknown Company",
          companyCode: company?.companyCode,
          companyEmail: company?.email,
          driverName: invitation.driverName,
          expiresAt: invitation.expiresAt,
        };
      }),
   }),

  // ─── Expenses ────────────────────────────────────────────────────────────
  expenses: router({
    /**
     * Upload a receipt image to S3 and return the URL.
     * Accepts base64-encoded image data from the mobile camera.
     */
    uploadReceipt: publicProcedure
      .input(z.object({
        driverCode: z.string().min(1),
        base64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
      }))
      .mutation(async ({ input }) => {
        const { storagePut } = await import("./storage");
        const buffer = Buffer.from(input.base64, "base64");
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const key = `expenses/${input.driverCode}/${Date.now()}-receipt.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url, key };
      }),

    /**
     * Save an expense record (with optional receipt URL) to the DB.
     */
    add: publicProcedure
      .input(z.object({
        loadId: z.string().min(1),
        driverCode: z.string().min(1),
        label: z.string().min(1).max(128),
        amountCents: z.number().int().min(0),
        expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        receiptUrl: z.string().url().optional(),
        receiptKey: z.string().optional(),
        notes: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createExpense(input);
        return { id };
      }),

    /**
     * Get all expenses for a load. Used by both the driver app and the company platform.
     */
    getByLoad: publicProcedure
      .input(z.object({ loadId: z.string().min(1) }))
      .query(async ({ input }) => {
        return db.getExpensesByLoad(input.loadId);
      }),

    /**
     * Get all expenses submitted by a driver across all loads.
     */
    getByDriver: publicProcedure
      .input(z.object({ driverCode: z.string().min(1) }))
      .query(async ({ input }) => {
        return db.getExpensesByDriver(input.driverCode);
      }),

    /**
     * Delete an expense. Only the owning driver can delete their own expense.
     */
    delete: publicProcedure
      .input(z.object({ id: z.number().int(), driverCode: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { receiptKey } = await db.deleteExpense(input.id, input.driverCode);
        // Best-effort S3 cleanup (non-fatal if it fails)
        if (receiptKey) {
          try {
            const { storageDelete } = await import("./storage");
            await storageDelete(receiptKey);
          } catch { /* ignore */ }
        }
        return { success: true };
      }),
  }),

  // ─── Gate Pass ───────────────────────────────────────────────────────────────
  gatePass: router({
    get: publicProcedure
      .input(z.object({ loadId: z.string().min(1) }))
      .query(async ({ input }) => {
        return db.getGatePass(input.loadId);
      }),
    upload: publicProcedure
      .input(z.object({
        loadId: z.string().min(1),
        companyCode: z.string().min(1),
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        base64Data: z.string().min(1),
        /** Optional ISO 8601 expiry date string, e.g. "2026-02-25T23:59:00Z" */
        expiresAt: z.string().optional(),
        /** Optional driver code (D-XXXXX or platform code) to notify on expiry */
        driverCode: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64Data, 'base64');
        const ext = input.fileName.split('.').pop() ?? 'bin';
        const key = 'gate-passes/' + input.loadId + '/' + Date.now() + '.' + ext;
        const { url } = await storagePut(key, buffer, input.mimeType);
        const id = await db.upsertGatePass({
          loadId: input.loadId,
          companyCode: input.companyCode,
          driverCode: input.driverCode,
          fileUrl: url,
          fileKey: key,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSizeBytes: buffer.length,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        });
        return { id, fileUrl: url, fileName: input.fileName, mimeType: input.mimeType, expiresAt: input.expiresAt ?? null, driverCode: input.driverCode ?? null };
      }),
    delete: publicProcedure
      .input(z.object({ loadId: z.string().min(1), companyCode: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const result = await db.deleteGatePass(input.loadId, input.companyCode);
        if (!result) return { success: false };
        const fileKey = result.fileKey;
        try { const { storageDelete } = await import('./storage'); await storageDelete(fileKey); } catch {}
        return { success: true };
      }),
  }),

  // ─── Locations: fetch/create locations from company platform ─────────────────
  locations: router({
    /**
     * Fetch all locations from the company platform.
     * Falls back to empty array if the platform endpoint is not yet available.
     */
    getAll: publicProcedure.query(async () => {
      try {
        return await companyPlatform.getLocations();
      } catch (err) {
        console.error("[locations.getAll] error:", err);
        return [];
      }
    }),

    /**
     * Create a new location on the company platform.
     * Returns the created location or null if the endpoint is not available.
     */
    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          address: z.string().optional(),
          city: z.string().optional(),
          province: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await companyPlatform.createLocation(input);
        return result;
      }),
  }),
});
export type AppRouter = typeof appRouter;

// NOTE: gate pass router appended below the closing }); above — we need to insert before it
