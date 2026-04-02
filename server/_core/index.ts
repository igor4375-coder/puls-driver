import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import * as db from "../db";
import { sendPushNotification } from "../push";
import { createPresignedUploadUrl, storageDownload, storagePut } from "../storage";
import { scheduleGatePassExpiryNotifier } from "../gate-pass-notifier";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Webhook-Secret",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });


  // ─── Presigned Upload URL (photos upload directly to R2) ───────────────────
  app.get("/api/photos/upload-url", async (req, res) => {
    try {
      const ext = (req.query.ext as string) || "jpg";
      const groupKey = (req.query.groupKey as string) || "inspections";
      const clientId = (req.query.clientId as string) || "";
      const contentType = ext === "png" ? "image/png" : "image/jpeg";

      const suffix = Math.random().toString(36).slice(2, 10);
      const key = `${groupKey}/${Date.now()}-${suffix}.${ext}`;

      const result = await createPresignedUploadUrl(key, contentType);
      res.json({ ...result, clientId });
    } catch (err) {
      console.error("[Photos] presigned URL error:", err);
      const message = err instanceof Error ? err.message : "Failed to create upload URL";
      res.status(500).json({ error: message });
    }
  });

  // ─── Async Photo Stamping (fire-and-forget from mobile app) ─────────────────
  // Mobile uploads the raw photo to R2 first, then calls this endpoint.
  // Server downloads the photo from R2, burns the evidence stamp, re-uploads.
  app.post("/api/photos/stamp-async", async (req, res) => {
    const { key, inspectionType, driverCode, companyName, vin, locationLabel, lat, lng, capturedAt } = req.body as {
      key?: string;
      inspectionType?: string;
      driverCode?: string;
      companyName?: string;
      vin?: string;
      locationLabel?: string;
      lat?: number;
      lng?: number;
      capturedAt?: string;
    };

    if (!key) {
      res.status(400).json({ error: "key is required" });
      return;
    }

    // Respond immediately — stamping happens in the background
    res.json({ accepted: true, key });

    try {
      const { stampPhotoBuffer } = await import("../photo-stamp-server.js");
      const photoBuffer = await storageDownload(key);

      const ts = capturedAt ? new Date(capturedAt) : new Date();
      const dateStr = ts.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
      const timeStr = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
      const inspType = inspectionType ?? "Inspection";
      const locPart = locationLabel
        ?? (lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "");

      const line1 = locPart
        ? `${inspType}: ${dateStr}  ${timeStr}, ${locPart}`
        : `${inspType}: ${dateStr}  ${timeStr}`;

      const parts = [
        driverCode ? `Driver: ${driverCode}` : "",
        vin ? `VIN: ${vin}` : "",
        companyName ?? "Puls Dispatch",
      ].filter(Boolean);
      const line2 = parts.join("  ·  ");

      const stamped = await stampPhotoBuffer(photoBuffer, { line1, line2 });
      await storagePut(key, stamped, "image/jpeg");
      console.log(`[Photos] async stamp complete for ${key}`);
    } catch (err) {
      console.error(`[Photos] async stamp failed for ${key}:`, err);
    }
  });

  /**
   * Webhook: called by the company platform when a load is assigned to a driver.
   * The platform POSTs { driverCode, loadNumber, vehicleDescription, pickupLocation, deliveryLocation }
   * and we look up the driver's push token and send a push notification.
   *
   * Security: protected by a shared webhook secret (WEBHOOK_SECRET env var).
   * The platform must include the header: X-Webhook-Secret: <secret>
   */
  app.post("/api/webhooks/load-assigned", async (req, res) => {
    try {
      const secret = process.env.WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers["x-webhook-secret"];
        if (provided !== secret) {
          res.status(401).json({ error: "Invalid webhook secret" });
          return;
        }
      }

      const { driverCode, loadNumber, vehicleDescription, pickupLocation, deliveryLocation } = req.body as {
        driverCode?: string;
        loadNumber?: string;
        vehicleDescription?: string;
        pickupLocation?: string;
        deliveryLocation?: string;
      };

      if (!driverCode) {
        res.status(400).json({ error: "driverCode is required" });
        return;
      }

      let profile = await db.getDriverProfileByCode(driverCode);
      if (!profile) {
        profile = await db.getDriverProfileByPlatformCode(driverCode);
      }
      if (!profile?.pushToken) {
        console.log(`[Webhook] No push token for driver ${driverCode} — skipping notification`);
        res.json({ success: true, notified: false, reason: "no_push_token" });
        return;
      }

      if (profile.notifyNewLoad === false) {
        console.log(`[Webhook] Driver ${driverCode} has new-load notifications disabled — skipping`);
        res.json({ success: true, notified: false, reason: "notifications_disabled" });
        return;
      }

      const title = "New Load Assigned";
      const body = vehicleDescription
        ? `${vehicleDescription} — ${pickupLocation ?? ""} → ${deliveryLocation ?? ""}`
        : `Load ${loadNumber ?? ""} has been assigned to you`;

      await sendPushNotification(
        profile.pushToken,
        title,
        body,
        { type: "load_assigned", loadNumber, driverCode },
        "loads"
      );

      console.log(`[Webhook] Push notification sent to driver ${driverCode} for load ${loadNumber}`);
      res.json({ success: true, notified: true });
    } catch (err) {
      console.error("[Webhook] load-assigned error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * Webhook: called by the company platform when a load's details are updated.
   * The platform POSTs { driverCode, loadNumber, vehicleDescription, changeDescription }
   * where changeDescription is a short human-readable summary of what changed,
   * e.g. "Rate updated to $850", "Delivery location changed to IAA Toronto".
   *
   * Security: same shared WEBHOOK_SECRET header as load-assigned.
   */
  app.post("/api/webhooks/load-updated", async (req, res) => {
    try {
      const secret = process.env.WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers["x-webhook-secret"];
        if (provided !== secret) {
          res.status(401).json({ error: "Invalid webhook secret" });
          return;
        }
      }

      const { driverCode, loadNumber, vehicleDescription, changeDescription } = req.body as {
        driverCode?: string;
        loadNumber?: string;
        vehicleDescription?: string;
        changeDescription?: string;
      };

      if (!driverCode) {
        res.status(400).json({ error: "driverCode is required" });
        return;
      }

      let profile = await db.getDriverProfileByCode(driverCode);
      if (!profile) {
        profile = await db.getDriverProfileByPlatformCode(driverCode);
      }
      if (!profile?.pushToken) {
        console.log(`[Webhook] No push token for driver ${driverCode} — skipping load-updated notification`);
        res.json({ success: true, notified: false, reason: "no_push_token" });
        return;
      }

      if (profile.notifyNewLoad === false) {
        res.json({ success: true, notified: false, reason: "notifications_disabled" });
        return;
      }

      const vehicle = vehicleDescription ?? `Load ${loadNumber ?? ""}`;
      const body = changeDescription
        ? `${vehicle}: ${changeDescription}`
        : `${vehicle} has been updated by dispatch`;

      await sendPushNotification(
        profile.pushToken,
        "Load Updated",
        body,
        { type: "load_updated", loadNumber, driverCode },
        "loads"
      );

      console.log(`[Webhook] load-updated push sent to driver ${driverCode} for load ${loadNumber}`);
      res.json({ success: true, notified: true });
    } catch (err) {
      console.error("[Webhook] load-updated error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * Webhook: called by the company platform when a load is removed/unassigned from a driver.
   * The platform POSTs { driverCode, loadNumber, vehicleDescription, reason }
   * where reason is optional context, e.g. "Load cancelled", "Reassigned to another driver".
   *
   * Security: same shared WEBHOOK_SECRET header as load-assigned.
   */
  app.post("/api/webhooks/load-removed", async (req, res) => {
    try {
      const secret = process.env.WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers["x-webhook-secret"];
        if (provided !== secret) {
          res.status(401).json({ error: "Invalid webhook secret" });
          return;
        }
      }

      const { driverCode, loadNumber, vehicleDescription, reason } = req.body as {
        driverCode?: string;
        loadNumber?: string;
        vehicleDescription?: string;
        reason?: string;
      };

      if (!driverCode) {
        res.status(400).json({ error: "driverCode is required" });
        return;
      }

      let profile = await db.getDriverProfileByCode(driverCode);
      if (!profile) {
        profile = await db.getDriverProfileByPlatformCode(driverCode);
      }
      if (!profile?.pushToken) {
        console.log(`[Webhook] No push token for driver ${driverCode} — skipping load-removed notification`);
        res.json({ success: true, notified: false, reason: "no_push_token" });
        return;
      }

      if (profile.notifyNewLoad === false) {
        res.json({ success: true, notified: false, reason: "notifications_disabled" });
        return;
      }

      const vehicle = vehicleDescription ?? `Load ${loadNumber ?? ""}`;
      const body = reason
        ? `${vehicle}: ${reason}`
        : `${vehicle} has been removed from your assignments`;

      await sendPushNotification(
        profile.pushToken,
        "Load Removed",
        body,
        { type: "load_removed", loadNumber, driverCode },
        "loads"
      );

      console.log(`[Webhook] load-removed push sent to driver ${driverCode} for load ${loadNumber}`);
      res.json({ success: true, notified: true });
    } catch (err) {
      console.error("[Webhook] load-removed error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Driver Location Ping Endpoint ───────────────────────────────────────────
  app.post("/api/driver-location", async (req, res) => {
    try {
      const { driverCode, pings } = req.body as {
        driverCode?: string;
        pings?: Array<{
          lat: number;
          lng: number;
          accuracy?: number | null;
          speed?: number | null;
          heading?: number | null;
          timestamp: number;
        }>;
      };

      if (!driverCode || !pings || pings.length === 0) {
        res.status(400).json({ error: "driverCode and pings[] are required" });
        return;
      }

      await db.insertDriverLocationPings(driverCode, pings);
      res.json({ success: true, count: pings.length });
    } catch (err) {
      console.error("[Location] insert error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Company platform fetches latest driver positions
  app.get("/api/driver-locations", async (req, res) => {
    try {
      const secret = process.env.WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers["x-webhook-secret"] ?? req.query.secret;
        if (provided !== secret) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
      }
      const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;
      const locations = await db.getLatestDriverLocations(companyId);
      res.json({ success: true, locations });
    } catch (err) {
      console.error("[Location] fetch error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
    // Start the gate pass expiry notification scheduler
    scheduleGatePassExpiryNotifier();
  });
}

startServer().catch(console.error);
