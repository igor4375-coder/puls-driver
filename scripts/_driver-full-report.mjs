import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CODE = process.argv[2] || "D-56932";
const URL = process.env.EXPO_PUBLIC_CONVEX_URL;
const client = new ConvexHttpClient(URL);

const profile = await client.query(api.driverProfiles.getByDriverCode, { driverCode: CODE });
if (!profile) { console.log("NO PROFILE"); process.exit(0); }

console.log("=== DRIVER PROFILE ===");
console.log("Name:            ", profile.name);
console.log("Email:           ", profile.email);
console.log("Driver code:     ", profile.driverCode);
console.log("Status:          ", profile.status);
console.log("Phone verified:  ", profile.phoneVerified);
console.log("Phone number:    ", profile.phone ?? "(none)");
console.log("Platform code:   ", profile.platformDriverCode ?? "(not registered on dispatcher platform)");
console.log("Push token:      ", profile.expoPushToken ? "yes" : "no");
console.log("Signed up:       ", new Date(profile._creationTime).toISOString(), "(" + new Date(profile._creationTime).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " US Central)");
console.log("Clerk user id:   ", profile.clerkUserId);
console.log("Convex _id:      ", profile._id);

const platformLoads = await client.action(api.platform.getAssignedLoads, { driverCode: CODE }).catch(e => ({ error: String(e) }));
console.log("\n=== ASSIGNED LOADS (from company platform) ===");
console.log(JSON.stringify(platformLoads, null, 2));
