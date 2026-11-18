// account.mjs — what makes an account its owner's: a new password when the old
// one is forgotten, proof that the email address is theirs, a new password
// while signed in, and the way out (the account and its data deleted).
//
// The links sent by email carry a random token; only its SHA-256 is stored
// (table account_tokens), each works once and expires. Answers never say
// whether an email or a username exists.

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { all, get, run } from "./db.mjs";
import { countAdmins, createSession, getUserById, getUserByLogin, hashPassword, verifyPassword } from "./auth.mjs";
import { limit } from "./security.mjs";

const RESET_TTL_MS = 60 * 60 * 1000; // one hour
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // one day
/** What a replay shows in place of a player who deleted their account. */
export const DELETED_NAME = "Deleted captain";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const passwordSchema = z.string().min(8).max(200);

/** A one-use token of `kind` for the user; an older one of the same kind stops working. */
async function newToken(userId, kind, ttlMs) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await run(`DELETE FROM account_tokens WHERE (user_id=? AND kind=?) OR expires_at < ?`, [userId, kind, now]);
  await run(`INSERT INTO account_tokens (token_hash,user_id,kind,created_at,expires_at) VALUES (?,?,?,?,?)`, [sha256(token), userId, kind, now, now + ttlMs]);
  return token;
}

/** The user a token of `kind` belongs to, if it is still good. The token is used up. */
async function useToken(token, kind) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await get(`SELECT * FROM account_tokens WHERE token_hash=? AND kind=?`, [sha256(token), kind]);
  if (!row) return null;
  await run(`DELETE FROM account_tokens WHERE token_hash=?`, [row.token_hash]);
  return row.expires_at < Date.now() ? null : getUserById(row.user_id);
}

/** Takes a deleted account's name and words out of the replays that stay (the other player's games). */
async function anonymizeReplays(userId) {
  // games only this player sent in (against the AI, at one screen) go with the account
  const own = await all(`SELECT id FROM replays WHERE saved_by=? AND source IN ('ai','local')`, [userId]);
  for (const r of own) {
    await run(`UPDATE matches SET replay_id=NULL WHERE replay_id=?`, [r.id]);
    await run(`DELETE FROM replays WHERE id=?`, [r.id]);
  }
  const shared = await all(`SELECT id, user_a, user_b, record FROM replays WHERE user_a=? OR user_b=?`, [userId, userId]);
  for (const r of shared) {
    const pid = r.user_a === userId ? "seatA" : "seatB";
    const record = JSON.parse(r.record);
    for (const seat of record.seats ?? []) if (seat.pid === pid) seat.name = DELETED_NAME;
    record.chat = (record.chat ?? []).filter((line) => line.seat !== pid);
    await run(`UPDATE replays SET ${pid === "seatA" ? "name_a" : "name_b"}=?, record=? WHERE id=?`, [DELETED_NAME, JSON.stringify(record), r.id]);
  }
}

/**
 * `mailer`: mail.mjs. `publicUrl`: the site's address for links in mails.
 * `sessions`: { cookie, set(reply, token), clear(reply) } — index.mjs owns the session cookie.
 * Returns `sendVerification(user)`, for the signup route.
 */
export function registerAccount(app, { requireUser, requireAdmin, mailer, publicUrl, sessions }) {
  const link = (param, token) => `${publicUrl}/?${param}=${token}`;

  async function sendVerification(user) {
    if (!mailer.configured || user.email_verified_at) return false;
    const token = await newToken(user.id, "verify", VERIFY_TTL_MS);
    return mailer.send({
      to: user.email,
      subject: "Sailing Network: confirm your email address",
      text: `Ahoy ${user.display_name},\n\nopen this link to confirm that this address is yours:\n${link("verify", token)}\n\nIt works once, for one day. If you did not create an account on Sailing Network, ignore this message.`,
    });
  }

  // "I forgot my password": a link by email. The answer is the same whether the account exists or not.
  app.post("/api/auth/forgot", limit(5, "10 minutes"), async (req, reply) => {
    const p = z.object({ identifier: z.string().min(1).max(200) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Write your email or your username" });
    const user = mailer.configured ? await getUserByLogin(p.data.identifier.trim()) : null;
    if (user && !user.is_bot) {
      const token = await newToken(user.id, "reset", RESET_TTL_MS);
      await mailer.send({
        to: user.email,
        subject: "Sailing Network: set a new password",
        text: `Ahoy ${user.display_name},\n\nopen this link to choose a new password:\n${link("reset", token)}\n\nIt works once, for one hour. If you did not ask for it, ignore this message: your password stays as it is.`,
      });
    }
    // mail: false = this server sends no email; an admin can hand out a reset link
    return reply.send({ ok: true, mail: mailer.configured });
  });

  // The link's other end: a new password. Every session of the account ends.
  app.post("/api/auth/reset", limit(10, "10 minutes"), async (req, reply) => {
    const p = z.object({ token: z.string(), password: passwordSchema }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "The password needs at least 8 characters" });
    const user = await useToken(p.data.token, "reset");
    if (!user) return reply.code(400).send({ error: "This link is no longer valid. Ask for a new one." });
    await run(`UPDATE users SET password_hash=? WHERE id=?`, [await hashPassword(p.data.password), user.id]);
    await run(`DELETE FROM sessions WHERE user_id=?`, [user.id]);
    await run(`DELETE FROM account_tokens WHERE user_id=? AND kind='reset'`, [user.id]);
    return reply.send({ ok: true });
  });

  // No email on this server, or the mail never arrived: an admin makes the link and passes it on.
  app.post("/api/admin/users/:id/reset-link", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const target = await getUserById(req.params.id);
    if (!target) return reply.code(404).send({ error: "User not found" });
    const token = await newToken(target.id, "reset", RESET_TTL_MS);
    // a path, not an address: the admin page puts its own origin in front
    return reply.send({ path: `/?reset=${token}`, expiresInMinutes: RESET_TTL_MS / 60000 });
  });

  // A new password while signed in. The other devices are signed out; this one stays in.
  app.post("/api/me/password", limit(10, "10 minutes"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const p = z.object({ current: z.string().min(1).max(200), next: passwordSchema }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "The new password needs at least 8 characters" });
    if (!(await verifyPassword(user.password_hash, p.data.current).catch(() => false))) return reply.code(403).send({ error: "The current password is not right" });
    await run(`UPDATE users SET password_hash=? WHERE id=?`, [await hashPassword(p.data.next), user.id]);
    await run(`DELETE FROM sessions WHERE user_id=?`, [user.id]);
    sessions.set(reply, await createSession(user.id));
    return reply.send({ ok: true });
  });

  app.post("/api/me/verify/send", limit(5, "10 minutes"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.email_verified_at) return reply.send({ sent: false, verified: true });
    return reply.send({ sent: await sendVerification(user), mail: mailer.configured });
  });

  app.post("/api/auth/verify", limit(20, "10 minutes"), async (req, reply) => {
    const user = await useToken(req.body?.token, "verify");
    if (!user) return reply.code(400).send({ error: "This link is no longer valid. Ask for a new one from your profile." });
    await run(`UPDATE users SET email_verified_at=? WHERE id=? AND email_verified_at IS NULL`, [Date.now(), user.id]);
    return reply.send({ ok: true });
  });

  // The way out. Everything that is the account's goes with it (the tables cascade);
  // the other players keep their own records of the games, without this account's name.
  app.delete("/api/me/account", limit(5, "10 minutes"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const p = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!p.success || !(await verifyPassword(user.password_hash, p.data.password).catch(() => false))) {
      return reply.code(403).send({ error: "The password is not right" });
    }
    if (user.role === "admin" && (await countAdmins()) <= 1) return reply.code(400).send({ error: "The last admin cannot delete their account" });
    await anonymizeReplays(user.id);
    await run(`DELETE FROM users WHERE id=?`, [user.id]);
    sessions.clear(reply);
    return reply.send({ ok: true });
  });

  return { sendVerification };
}
