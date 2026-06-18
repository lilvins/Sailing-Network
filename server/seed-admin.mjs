// seed-admin.mjs — create (or promote) an admin account.
//
//   npm run seed:admin                                  # defaults below
//   ADMIN_EMAIL=me@x.com ADMIN_PASSWORD=secret npm run seed:admin
//   node server/seed-admin.mjs <email> <username> <password>
//
// If a user with that email/username exists, they are promoted to admin.

import { initDb, run } from "./db.mjs";
import { hashPassword, createUser, getUserByEmail, getUserByUsername } from "./auth.mjs";

await initDb();

const email = process.env.ADMIN_EMAIL || process.argv[2] || "admin@sailing.local";
const username = process.env.ADMIN_USERNAME || process.argv[3] || "admin";
const password = process.env.ADMIN_PASSWORD || process.argv[4] || "admin12345";

const existing = (await getUserByEmail(email)) || (await getUserByUsername(username));

if (existing) {
  if (existing.role !== "admin") {
    await run(`UPDATE users SET role='admin' WHERE id=?`, [existing.id]);
    console.log(`Promoted "${existing.username}" (${existing.email}) to admin.`);
  } else {
    console.log(`Admin "${existing.username}" (${existing.email}) already exists — nothing to do.`);
  }
} else {
  const password_hash = await hashPassword(password);
  const u = await createUser({ email, username, password_hash, role: "admin", display_name: username });
  console.log("Created admin account:");
  console.log(`  email:    ${u.email}`);
  console.log(`  username: ${u.username}`);
  console.log(`  password: ${password}`);
  console.log("  ⚠ change this password (set ADMIN_PASSWORD) before any real use.");
}

process.exit(0);
