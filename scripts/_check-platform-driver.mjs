import "dotenv/config";

const CODE = process.argv[2] || "D-56932";
const BASE_URL = process.env.COMPANY_PLATFORM_URL || "https://grateful-orca-398.convex.site/api/trpc";
const API_KEY = process.env.COMPANY_PLATFORM_API_KEY;
if (!API_KEY) { console.error("COMPANY_PLATFORM_API_KEY not set"); process.exit(2); }

async function call(procedure, input, method = "query") {
  const body = JSON.stringify({ json: input });
  let url = `${BASE_URL}/${procedure}`;
  const init = {
    method: method === "query" ? "GET" : "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (method === "query") {
    url += `?input=${encodeURIComponent(body)}`;
  } else {
    init.body = body;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

console.log("=== driversApi.getAssignedLoads (raw) for", CODE, "===");
const loads = await call("driversApi.getAssignedLoads", { driverCode: CODE });
console.log("HTTP", loads.status);
console.log(JSON.stringify(loads.body, null, 2));

console.log("\n=== driversApi.getPendingInvites (raw) for", CODE, "===");
const invites = await call("driversApi.getPendingInvites", { driverCode: CODE });
console.log("HTTP", invites.status);
console.log(JSON.stringify(invites.body, null, 2));
