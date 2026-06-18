import { createClient } from "@libsql/client";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = createClient({
  url: pathToFileURL(join(__dirname, "server/sailing.db")).href,
  intMode: "number",
});

try {
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log("Tables in DB:");
  for (const t of tables.rows) {
    console.log(`  - ${t.name}`);
  }
  
  if (tables.rows.some(t => t.name === "user_presence")) {
    console.log("\n✅ user_presence table EXISTS!");
  } else {
    console.log("\n❌ user_presence table MISSING");
  }
} catch (e) {
  console.error("Error:", e.message);
}
