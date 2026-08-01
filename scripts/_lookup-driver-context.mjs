import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

const [[{ total }]] = await conn.execute("SELECT COUNT(*) AS total FROM driver_profiles");
console.log("total_drivers=" + total);

const [near] = await conn.execute(
  `SELECT driver_code, platform_driver_code, LEFT(name, 20) AS name, phone, createdAt
     FROM driver_profiles
    WHERE driver_code LIKE 'D-569%' OR driver_code LIKE 'D-5693%'
       OR platform_driver_code LIKE 'D-569%'
    ORDER BY driver_code
    LIMIT 20`
);
console.log("nearby_D-569xx rows=" + near.length);
console.log(JSON.stringify(near, null, 2));

const [recent] = await conn.execute(
  `SELECT driver_code, platform_driver_code, LEFT(name, 20) AS name, phone, phone_verified, createdAt
     FROM driver_profiles
    ORDER BY createdAt DESC
    LIMIT 5`
);
console.log("\nmost_recent_signups:");
console.log(JSON.stringify(recent, null, 2));

await conn.end();
