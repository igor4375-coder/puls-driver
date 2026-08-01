import "dotenv/config";
import mysql from "mysql2/promise";

const CODE = process.argv[2] || "D-56932";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(2); }

const conn = await mysql.createConnection(url);
const [rows] = await conn.execute(
  `SELECT id, userId, driver_code, platform_driver_code, name, email, phone,
          phone_verified, status, equipment_type, equipment_capacity,
          truckNumber, trailerNumber, licenseNumber,
          (pushToken IS NOT NULL) AS has_push_token,
          createdAt, updatedAt
     FROM driver_profiles
    WHERE driver_code = ? OR platform_driver_code = ?
    LIMIT 5`,
  [CODE, CODE]
);
console.log("MATCH_COUNT=" + rows.length);
console.log(JSON.stringify(rows, null, 2));
await conn.end();
