import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = createClient({ url: pathToFileURL(join(__dirname, 'server/sailing.db')).href });

// Get wano_ren's user ID
const ren = await db.execute({ sql: "SELECT id, username FROM users WHERE username='wano_ren'" }).then(r => r.rows[0]);
console.log("wano_ren:", ren);

if (ren) {
  // Check current presence
  const pres = await db.execute({ sql: "SELECT * FROM user_presence WHERE user_id=?", args: [ren.id] }).then(r => r.rows[0]);
  console.log("Current presence:", pres);

  // Set offline
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO user_presence (user_id, status, session_id, last_seen, updated_at)
          VALUES (?, 'offline', NULL, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET status='offline', last_seen=?, updated_at=?`,
    args: [ren.id, now, now, now, now]
  });
  console.log("✓ wano_ren set to OFFLINE in DB");

  const after = await db.execute({ sql: "SELECT status FROM user_presence WHERE user_id=?", args: [ren.id] }).then(r => r.rows[0]);
  console.log("New status:", after?.status);
}
