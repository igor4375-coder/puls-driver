/**
 * Probe the company platform to find the correct endpoint for marking a trip as picked up.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./load-env.js");

const BASE_URL = process.env.COMPANY_PLATFORM_URL ?? "https://3000-ij0y85xpy8g7q9lzvluoh-0279c63a.us1.manus.computer/api/trpc";
const API_KEY = process.env.COMPANY_PLATFORM_API_KEY ?? "";

async function callTRPC(procedure, input, method = "mutation") {
  const url = `${BASE_URL}/${procedure}`;
  const envelope = { json: input };
  let response;
  if (method === "query") {
    const params = new URLSearchParams({ input: JSON.stringify(envelope) });
    response = await fetch(`${url}?${params}`, {
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    });
  } else {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
  }
  const text = await response.text();
  console.log(`\n=== ${procedure} (${method}) ===`);
  console.log("Status:", response.status);
  try {
    console.log("Body:", JSON.stringify(JSON.parse(text), null, 2).slice(0, 600));
  } catch {
    console.log("Body:", text.slice(0, 600));
  }
  return { status: response.status, text };
}

// First get a real legId by fetching loads for a known driver
console.log("Fetching assigned loads for D-68544...");
const loadsResult = await callTRPC("driversApi.getAssignedLoads", { driverCode: "D-68544" }, "query");

let legId = null;
let loadNumber = null;
try {
  const parsed = JSON.parse(loadsResult.text);
  const loads = parsed?.result?.data?.json ?? parsed?.result?.data ?? [];
  if (Array.isArray(loads) && loads.length > 0) {
    legId = loads[0].legId ?? loads[0].tripId;
    loadNumber = loads[0].loadNumber;
    console.log(`\nFound load: legId=${legId}, loadNumber=${loadNumber}`);
  }
} catch {}

if (!legId) {
  console.log("\nNo loads found — using dummy legId=1 for probing");
  legId = 1;
  loadNumber = "TEST-001";
}

// Test 1: updateTripStatus (existing endpoint)
await callTRPC("driversApi.updateTripStatus", {
  tripId: legId,
  driverCode: "D-68544",
  status: "picked_up",
});

// Test 2: markAsPickedUp (new endpoint we added)
await callTRPC("driversApi.markAsPickedUp", {
  loadNumber,
  legId,
  driverCode: "D-68544",
  pickupTime: new Date().toISOString(),
  pickupGPS: { lat: 49.8954, lng: -97.1385 },
  pickupPhotos: ["https://example.com/photo1.jpg"],
});

// Test 3: markPickedUp (alternative name)
await callTRPC("driversApi.markPickedUp", {
  tripId: legId,
  driverCode: "D-68544",
});

// Test 4: updateStatus (alternative name)
await callTRPC("driversApi.updateStatus", {
  tripId: legId,
  driverCode: "D-68544",
  status: "picked_up",
});
