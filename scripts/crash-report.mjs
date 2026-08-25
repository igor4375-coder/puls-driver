/**
 * Reads client crash/diagnostic reports out of Convex.
 *
 *   node scripts/crash-report.mjs              # 30 most recent, all drivers
 *   node scripts/crash-report.mjs D-56932      # one driver
 *   node scripts/crash-report.mjs D-56932 100  # ...with a bigger window
 */
import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const driverCode = process.argv[2] && process.argv[2].startsWith("D-") ? process.argv[2] : null;
const limit = Number(process.argv[driverCode ? 3 : 2]) || 30;

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("EXPO_PUBLIC_CONVEX_URL not set");
  process.exit(2);
}

const client = new ConvexHttpClient(url);
const rows = driverCode
  ? await client.query(api.diagnostics.recentForDriver, { driverCode, limit })
  : await client.query(api.diagnostics.recent, { limit });

if (rows.length === 0) {
  console.log("No diagnostics reported yet.");
  process.exit(0);
}

const mb = (bytes) => (bytes ? `${Math.round(bytes / 1024 / 1024)}MB` : "?");

for (const r of rows) {
  const foreground = r.appState === "active";
  const flag = r.kind === "memory_warning" || (r.kind === "abnormal_termination" && foreground) ? "  <-- USER-VISIBLE" : "";
  console.log("=".repeat(78));
  console.log(`${r.reportedAt}  ${r.kind}${flag}`);
  console.log(`  driver=${r.driverCode ?? "?"}  build=${r.buildTag ?? "?"}  device=${r.deviceModel ?? "?"} iOS ${r.osVersion ?? "?"}  ram=${mb(r.totalMemoryBytes)}`);
  console.log(`  appState=${r.appState ?? "?"}  route=${r.route ?? "?"}  memoryWarnings=${r.memoryWarnings ?? 0}`);
  console.log(
    `  photoQueue: total=${r.photoQueueTotal ?? "?"} pending=${r.photoQueuePending ?? "?"} uploading=${r.photoQueueUploading ?? "?"} failed=${r.photoQueueFailed ?? "?"} payload=${mb(r.photoQueueBytes)}  syncQueue=${r.syncQueueDepth ?? "?"}`,
  );
  if (r.silentForMs != null) {
    console.log(`  silent for ${Math.round(r.silentForMs / 1000)}s before relaunch`);
  }
  if (r.message) console.log(`  message: ${r.message}`);
  if (r.stack) console.log(`  stack:\n${r.stack.split("\n").slice(0, 12).map((l) => "    " + l).join("\n")}`);
  if (r.breadcrumbs?.length) {
    console.log("  breadcrumbs:");
    for (const b of r.breadcrumbs) console.log(`    ${b}`);
  }
}

console.log("=".repeat(78));
const kills = rows.filter((r) => r.kind === "abnormal_termination" && r.appState === "active").length;
const warnings = rows.filter((r) => r.kind === "memory_warning").length;
console.log(`${rows.length} reports · ${kills} foreground kills · ${warnings} memory warnings`);
