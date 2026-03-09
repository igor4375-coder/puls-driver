/**
 * Quick diagnostic: call getAssignedLoads for a driver code and print the result.
 * Run with: cd /home/ubuntu/driver-app && npx tsx --tsconfig tsconfig.json scripts/test-platform-loads.mts D-XXXXX
 */
// Load env vars first
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local"), override: true });

const BASE_URL =
  process.env.COMPANY_PLATFORM_URL ??
  "https://3000-ij0y85xpy8g7q9lzvluoh-0279c63a.us1.manus.computer/api/trpc";

const API_KEY = process.env.COMPANY_PLATFORM_API_KEY ?? "";

const driverCode = process.argv[2] ?? "D-00001";
console.log(`[test] Fetching loads for driverCode: ${driverCode}`);
console.log(`[test] COMPANY_PLATFORM_URL: ${BASE_URL}`);
console.log(`[test] COMPANY_PLATFORM_API_KEY: ${API_KEY ? `SET (${API_KEY.slice(0, 6)}...)` : "MISSING"}`);

const envelope = { json: { driverCode } };
const params = new URLSearchParams({ input: JSON.stringify(envelope) });
const url = `${BASE_URL}/driversApi.getAssignedLoads?${params.toString()}`;

console.log(`[test] Calling: ${url.slice(0, 120)}...`);

const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
});

const text = await response.text();
console.log(`[test] HTTP status: ${response.status}`);
console.log(`[test] Response:`, text.slice(0, 2000));
