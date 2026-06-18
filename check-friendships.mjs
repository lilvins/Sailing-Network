import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "server/sailing.db");

const db = createClient({
  url: pathToFileURL(DB_PATH).href,
});

// Get test captain's ID
const testCaptain = await db.execute({
  sql: "SELECT id, username FROM users WHERE username = 'test_captain'",
}).then(r => r.rows[0]);

console.log("Test Captain:", testCaptain);

if (testCaptain) {
  // Get their friends
  const friends = await db.execute({
    sql: `SELECT 
      CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END as friend_id,
      status,
      role
    FROM friendships 
    WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`,
    args: [testCaptain.id, testCaptain.id, testCaptain.id]
  }).then(r => r.rows);

  console.log(`\n${friends.length} accepted friends:`);
  
  for (const f of friends) {
    const user = await db.execute({
      sql: "SELECT username FROM users WHERE id = ?",
      args: [f.friend_id]
    }).then(r => r.rows[0]);
    
    const pres = await db.execute({
      sql: "SELECT status FROM user_presence WHERE user_id = ?",
      args: [f.friend_id]
    }).then(r => r.rows[0]);
    
    console.log(`  - ${user?.username} (status: ${pres?.status || 'NO_PRESENCE_RECORD'})`);
  }
}
