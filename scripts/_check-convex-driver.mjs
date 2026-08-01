import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CODE = process.argv[2] || "D-56932";
const URL = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!URL) { console.error("EXPO_PUBLIC_CONVEX_URL not set"); process.exit(2); }

const client = new ConvexHttpClient(URL);
const profile = await client.query(api.driverProfiles.getByDriverCode, { driverCode: CODE });
console.log("CONVEX_URL=" + URL);
console.log("driver_code=" + CODE);
console.log("result:");
console.log(JSON.stringify(profile, null, 2));
