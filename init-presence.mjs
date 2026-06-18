import { createClient } from "@libsql/client";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = createClient({
  url: pathToFileURL(join(__dirname, "server/sailing.db")).href,
  intMode: "number",
});

const users = await db.execute("SELECT id FROM users");
const now = Date.now();

for (const u of users.rows) {
  await db.execute(
    `INSERT OR REPLACE INTO user_presence (user_id, status, session_id, last_seen, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [u.id, "online", randomUUID(), now, now]
  );
}

console.log(`✅ Initialized presence for ${users.rows.length} users`);
