// auth.mjs — user + session helpers. Passwords hashed with argon2id.
// Session tokens are opaque random strings; only their SHA-256 is stored, so a DB
// leak can't be used to forge sessions. Cookies carry the raw token (httpOnly).
// All DB access is async (libsql).

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { get, run } from "./db.mjs";
import { getActiveBan } from "./store.mjs";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const hashPassword = (pw) => hash(pw); // argon2id, sane defaults
export const verifyPassword = (h, pw) => verify(h, pw);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---- users ----
export async function createUser({ email, username, password_hash, role = "user", display_name }) {
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO users (id,email,username,password_hash,role,display_name,created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, email.toLowerCase(), username, password_hash, role, display_name, now]
  );
  return getUserById(id);
}

export const getUserById = (id) => get(`SELECT * FROM users WHERE id=?`, [id]);
export const getUserByEmail = (e) => get(`SELECT * FROM users WHERE email=?`, [String(e).toLowerCase()]);
export const getUserByUsername = (u) => get(`SELECT * FROM users WHERE username=?`, [u]);
export const getUserByLogin = (idf) => (String(idf).includes("@") ? getUserByEmail(idf) : getUserByUsername(idf));

export const countAdmins = async () => Number((await get(`SELECT COUNT(*) AS c FROM users WHERE role='admin'`)).c);

// ---- bans (login gate) ----
// Returns null if the user may log in, or { message, ban } if they're actively
// banned. Callers should refuse session creation with 403 and `message` when
// this returns non-null. Expired bans return null, so login auto-reenables.
export async function checkBanned(userId) {
  const ban = await getActiveBan(userId);
  if (!ban) return null;
  const reason = ban.reason || "no reason given";
  const until = ban.expires_at
    ? `until ${new Date(ban.expires_at).toISOString()}`
    : "permanently";
  return { ban, message: `Account banned ${until} for: ${reason}` };
}

// ---- sessions ----
export async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await run(`INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)`, [
    sha256(token),
    userId,
    now,
    now + SESSION_TTL_MS,
  ]);
  return token;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const row = await get(`SELECT * FROM sessions WHERE token_hash=?`, [sha256(token)]);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await destroySession(token);
    return null;
  }
  return getUserById(row.user_id);
}

export async function destroySession(token) {
  if (!token) return;
  await run(`DELETE FROM sessions WHERE token_hash=?`, [sha256(token)]);
}

// strip secrets before sending a user to the client
export const publicUser = (u) =>
  u && {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    displayName: u.display_name,
    createdAt: u.created_at,
  };
