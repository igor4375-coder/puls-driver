import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local"), override: true });

const conn = await mysql.createConnection(process.env.DATABASE_URL ?? "");
const [rows] = await conn.execute("SELECT * FROM driver_profiles ORDER BY id DESC LIMIT 20");
console.log("=== driver_profiles ===");
console.log(JSON.stringify(rows, null, 2));

const [companies] = await conn.execute("SELECT * FROM driver_companies ORDER BY id DESC LIMIT 20");
console.log("\n=== driver_companies ===");
console.log(JSON.stringify(companies, null, 2));

await conn.end();
