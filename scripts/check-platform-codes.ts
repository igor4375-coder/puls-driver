import { getDb } from "../server/db";
import { driverProfiles } from "../drizzle/schema";
import { desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("DB not available");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: driverProfiles.id,
      name: driverProfiles.name,
      driverCode: driverProfiles.driverCode,
      platformDriverCode: driverProfiles.platformDriverCode,
      phone: driverProfiles.phone,
    })
    .from(driverProfiles)
    .orderBy(desc(driverProfiles.id))
    .limit(10);

  console.log("Driver profiles (newest first):");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
