// seed-avatars.mjs — give EVERY account a random leader as its profile picture.
//   npm run seed:avatars
// Sets profiles.favorite_leader to a random Leader card id and matches
// avatar_color to that leader's primary color.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initDb, all, run } from "./db.mjs";

await initDb();

const __dirname = dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(readFileSync(join(__dirname, "..", "public", "data", "cards.json"), "utf8"));
const leaders = cards.filter((c) => c.category === "Leader");
const COLOR = { Red: "#c0392b", Green: "#1f8a5b", Blue: "#2a6fdb", Purple: "#7a3fa0", Black: "#2c3138", Yellow: "#caa023" };

const users = await all(`SELECT id, username FROM users`);
for (const u of users) {
  const L = leaders[Math.floor(Math.random() * leaders.length)];
  const color = COLOR[L.colors?.[0]] || "#7a3030";
  await run(`INSERT INTO profiles (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING`, [u.id, Date.now()]);
  await run(`UPDATE profiles SET favorite_leader=?, avatar_color=?, updated_at=? WHERE user_id=?`, [L.id, color, Date.now(), u.id]);
  console.log(`${u.username.padEnd(16)} → ${L.name} (${L.id})`);
}
console.log(`\nAssigned random leader avatars to ${users.length} accounts.`);
process.exit(0);
