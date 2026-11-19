// moderation.mjs — what keeps people safe from each other: blocking a
// player, reporting one to the admins, and deleting a message.
//
// A block is one-way and silent: the blocked player is not told, their DMs and
// friend requests are refused, and their lines leave the blocker's chat.
// A report copies the words it is about, so it still reads after a delete.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, get, run } from "./db.mjs";
import { getUserByUsername } from "./auth.mjs";
import { limit } from "./security.mjs";

/** Has `ownerId` blocked `otherId`? */
export const hasBlocked = async (ownerId, otherId) => !!(await get(`SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?`, [ownerId, otherId]));

/** The ids `userId` has blocked. */
export const blockedIds = async (userId) => new Set((await all(`SELECT blocked_id FROM blocks WHERE user_id=?`, [userId])).map((r) => r.blocked_id));

/** Why `fromId` may not write to `toId` (a DM, a friend request), or null. The blocked side gets no hint of the block. */
export async function contactRefusal(fromId, toId) {
  if (await hasBlocked(fromId, toId)) return "You blocked this captain. Unblock them to write.";
  if (await hasBlocked(toId, fromId)) return "This captain is not taking messages.";
  return null;
}

const reportSchema = z.object({
  username: z.string().min(1).max(40),
  kind: z.enum(["dm", "chat", "profile", "game"]),
  reason: z.string().trim().min(3).max(500),
  /** The message the report is about (kind dm or chat). */
  messageId: z.string().max(80).optional(),
});

const reportToClient = (r) => ({
  id: r.id, kind: r.kind, reason: r.reason, excerpt: r.excerpt, status: r.status, createdAt: r.created_at, closedAt: r.closed_at,
  reporter: r.reporter_username ? { username: r.reporter_username, displayName: r.reporter_display } : null,
  target: { id: r.target_id, username: r.target_username, displayName: r.target_display },
});

export function registerModeration(app, { requireUser, requireAdmin }) {
  // ---- blocks ----
  app.get("/api/me/blocks", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await all(
      `SELECT u.username, u.display_name, b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? ORDER BY b.created_at DESC`, [user.id]);
    return reply.send({ blocks: rows.map((r) => ({ username: r.username, displayName: r.display_name, createdAt: r.created_at })) });
  });

  app.post("/api/me/blocks/:username", limit(60, "10 minutes"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const target = await getUserByUsername(req.params.username);
    if (!target) return reply.code(404).send({ error: "User not found" });
    if (target.id === user.id) return reply.code(400).send({ error: "You cannot block yourself" });
    await run(`INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?,?,?)`, [user.id, target.id, Date.now()]);
    // a block ends the friendship and the follows, both ways
    await run(`DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`, [user.id, target.id, target.id, user.id]);
    await run(`DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)`, [user.id, target.id, target.id, user.id]);
    return reply.send({ ok: true });
  });

  app.delete("/api/me/blocks/:username", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const target = await getUserByUsername(req.params.username);
    if (target) await run(`DELETE FROM blocks WHERE user_id=? AND blocked_id=?`, [user.id, target.id]);
    return reply.send({ ok: true });
  });

  // ---- reports ----
  app.post("/api/reports", limit(10, "10 minutes"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const p = reportSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Say who and why (3 to 500 characters)" });
    const target = await getUserByUsername(p.data.username);
    if (!target) return reply.code(404).send({ error: "User not found" });
    if (target.id === user.id) return reply.code(400).send({ error: "You cannot report yourself" });
    // the words themselves, read from the database: a reporter cannot make them up
    let excerpt = "";
    if (p.data.messageId && p.data.kind === "dm") {
      const m = await get(`SELECT body FROM messages WHERE id=? AND from_user_id=? AND to_user_id=?`, [p.data.messageId, target.id, user.id]);
      if (!m) return reply.code(404).send({ error: "Message not found" });
      excerpt = m.body;
    } else if (p.data.messageId && p.data.kind === "chat") {
      const m = await get(`SELECT body FROM global_messages WHERE id=? AND user_id=?`, [p.data.messageId, target.id]);
      if (!m) return reply.code(404).send({ error: "Message not found" });
      excerpt = m.body;
    }
    await run(`INSERT INTO reports (id, reporter_id, target_id, kind, reason, excerpt, created_at) VALUES (?,?,?,?,?,?,?)`,
      [randomUUID(), user.id, target.id, p.data.kind, p.data.reason, excerpt.slice(0, 1000), Date.now()]);
    return reply.code(201).send({ ok: true });
  });

  app.get("/api/admin/reports", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const status = req.query?.status === "closed" ? "closed" : "open";
    const rows = await all(
      `SELECT r.*, t.username AS target_username, t.display_name AS target_display, p.username AS reporter_username, p.display_name AS reporter_display
       FROM reports r JOIN users t ON t.id=r.target_id LEFT JOIN users p ON p.id=r.reporter_id
       WHERE r.status=? ORDER BY r.created_at DESC LIMIT 200`, [status]);
    const open = await get(`SELECT COUNT(*) AS c FROM reports WHERE status='open'`);
    return reply.send({ reports: rows.map(reportToClient), open: Number(open.c) });
  });

  app.patch("/api/admin/reports/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const status = req.body?.status === "open" ? "open" : "closed";
    const done = await run(`UPDATE reports SET status=?, closed_at=?, closed_by=? WHERE id=?`,
      [status, status === "closed" ? Date.now() : null, status === "closed" ? admin.id : null, req.params.id]);
    if (!done.rowsAffected) return reply.code(404).send({ error: "Report not found" });
    return reply.send({ ok: true });
  });

  // ---- deleting a message ----
  // global chat: one's own line, or any line for an admin
  app.delete("/api/chat/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const m = await get(`SELECT user_id FROM global_messages WHERE id=?`, [req.params.id]);
    if (!m) return reply.code(404).send({ error: "Message not found" });
    if (m.user_id !== user.id && user.role !== "admin") return reply.code(403).send({ error: "Not your message" });
    await run(`DELETE FROM global_messages WHERE id=?`, [req.params.id]);
    return reply.send({ ok: true });
  });

  // a private message: only who wrote it, and it goes for both
  app.delete("/api/messages/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const m = await get(`SELECT from_user_id FROM messages WHERE id=?`, [req.params.id]);
    if (!m) return reply.code(404).send({ error: "Message not found" });
    if (m.from_user_id !== user.id) return reply.code(403).send({ error: "Not your message" });
    await run(`DELETE FROM messages WHERE id=?`, [req.params.id]);
    return reply.send({ ok: true });
  });
}
