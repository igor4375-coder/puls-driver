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
      // Verify webhook secret
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

      // Look up the driver's push token.
      // The platform sends the platform-assigned driver code (e.g. D-11903).
      // Try local driverCode first, then fall back to platformDriverCode lookup.
      let profile = await db.getDriverProfileByCode(driverCode);
      if (!profile) {
        profile = await db.getDriverProfileByPlatformCode(driverCode);
      }
      if (!profile?.pushToken) {
        console.log(`[Webhook] No push token for driver ${driverCode} — skipping notification`);
        res.json({ success: true, notified: false, reason: "no_push_token" });
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
