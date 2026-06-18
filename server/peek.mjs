// peek.mjs — quick read-only dump of the local DB. `npm run db:peek`
// Password hashes are truncated; they are argon2id, never plaintext.
import { initDb, all } from "./db.mjs";

await initDb();

const users = await all(`SELECT id, email, username, role, display_name, created_at, password_hash FROM users ORDER BY created_at`);
console.log(`\n=== users (${users.length}) ===`);
for (const u of users) {
  console.log(
    `${u.username.padEnd(16)} | ${u.email.padEnd(28)} | role=${u.role.padEnd(5)} | hash=${String(u.password_hash).slice(0, 22)}…`
  );
}

const profiles = await all(`SELECT user_id, bio, supporter, favorite_leader, wins, losses FROM profiles`);
console.log(`\n=== profiles (${profiles.length}) ===`);
for (const p of profiles) {
  const u = users.find((x) => x.id === p.user_id);
  console.log(`${(u?.username || p.user_id).padEnd(16)} | fav=${String(p.favorite_leader).padEnd(10)} | sup=${p.supporter} | ${p.wins}W-${p.losses}L | "${(p.bio || "").slice(0, 40)}"`);
}

const decks = await all(`SELECT d.name, d.leader_id, d.format, u.username FROM decks d JOIN users u ON u.id = d.user_id ORDER BY u.username`);
console.log(`\n=== decks (${decks.length}) ===`);
for (const d of decks) console.log(`${d.username.padEnd(16)} | ${d.name.padEnd(28)} | leader=${d.leader_id} | ${d.format}`);

console.log("");
process.exit(0);
