// index.mjs — Sailing Network API (Fastify + libsql/SQLite + argon2).
// Accounts, sessions (httpOnly cookie), roles (user/admin), admin user management.
// Dev only for now: CORS open to the Vite origin with credentials.

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { initDb, all, run, get } from "./db.mjs";
import { registerCardArt } from "./card-art.mjs";
import { registerWelcome } from "./welcome.mjs";
import {
  hashPassword, verifyPassword, createUser, getUserById, getUserByEmail,
  getUserByUsername, getUserByLogin, createSession, getSessionUser,
  destroySession, publicUser, countAdmins, checkBanned,
} from "./auth.mjs";
import {
  ensureProfile, updateProfile, profileToClient,
  createDeck, getDeck, listDecks, updateDeck, deleteDeck, countDecks,
  deckToClient, deckSummary,
  listMatches, allMatches, matchToClient,
  sendFriendRequest, acceptFriend, deleteFriendship, listFriends, friendshipToClient,
  sendMessage, listThreads, listMessagesWith, markThreadRead, threadToClient, messageToClient,
  setUserPresence, getUserPresence, getPresenceOfFriends, presenceToClient, effectivePresence,
  createMatch,
  createMatchSession, getMatchSession, joinMatchSession, reportMatchResult, cancelMatchSession, listActiveMatches, getUserMatches, matchSessionToClient,
  joinQueue, leaveQueue, getQueuedPlayers, findOpponentForQueue,
  findAndPairMatches, getQueueStatus, markMatchReady, expireStaleMatches, estimateWaitLabel,
  ensureRating, getRating, updateRating,
  postGlobalMessage, listGlobalMessages, globalMessageToClient,
  createNotification, listNotifications, countUnreadNotifications, markNotificationsRead, notificationToClient,
  banUser, unbanUser, getActiveBan, listBans, banToClient,
} from "./store.mjs";
import { leaderboard as ladderBoard, profileStats, meta as metaStats, metaReport, ladderRating } from "./stats/index.mjs";

const COOKIE = "sn_session";
const isProd = process.env.NODE_ENV === "production";
// SN_API_PORT wins; PORT only in production (hosts set it). In dev, tools that
// launch `npm run dev` set PORT for the Vite port, and the API must not take it.
const PORT = Number(process.env.SN_API_PORT || (isProd && process.env.PORT) || 8787);

await initDb();

const app = Fastify({ logger: false });

await app.register(cors, {
  origin: true, // dev: reflect the requesting origin (Vite on :5173)
  credentials: true,
});
await app.register(cookie, {
  secret: process.env.COOKIE_SECRET || "dev-insecure-secret-change-me",
});
await app.register(rateLimit, { global: false });

// ---- helpers ----
function setSessionCookie(reply, token) {
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd, // https only in prod; http allowed in dev
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

const currentUser = (req) => getSessionUser(req.cookies[COOKIE]);

async function requireUser(req, reply) {
  const user = await currentUser(req);
  if (!user) {
    reply.code(401).send({ error: "Not authenticated" });
    return null;
  }
  return user;
}
async function requireAdmin(req, reply) {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    reply.code(403).send({ error: "Admin only" });
    return null;
  }
  return user;
}

// One matchmaking pass: expire no-show pending matches, then pair queued
// players. Wrapped so both the timer and the manual /api/queue/tick endpoint
// share the exact same logic. Never throws past here (logged + swallowed) so a
// transient DB error can't kill the interval.
async function runMatchmakingTick() {
  try {
    const expired = await expireStaleMatches();
    const created = await findAndPairMatches();
    return {
      ok: true,
      paired: created.length,
      expired,
      sessions: created.map(matchSessionToClient),
    };
  } catch (err) {
    console.error("[matchmaking] tick failed:", err);
    return { ok: false, error: String(err) };
  }
}

// ---- schemas ----
const signupSchema = z.object({
  email: z.string().email().max(200),
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "letters, numbers, underscore"),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(40).optional(),
});
const loginSchema = z.object({
  identifier: z.string().min(1).max(200), // email OR username
  password: z.string().min(1).max(200),
});
const roleSchema = z.object({ role: z.enum(["user", "admin"]) });
const banSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().min(1).max(200),
  durationDays: z.number().positive().nullable().optional(), // null/omitted = permanent
});
const presenceSchema = z.object({ status: z.enum(["offline", "online", "in_duel"]) });

const toClient = (r) => ({
  id: r.id,
  email: r.email,
  username: r.username,
  role: r.role,
  displayName: r.display_name,
  createdAt: r.created_at,
});

// ---- auth routes ----
app.post(
  "/api/auth/signup",
  { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
  async (req, reply) => {
    const p = signupSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Invalid input", details: p.error.flatten() });
    const { email, username, password, displayName } = p.data;
    if (await getUserByEmail(email)) return reply.code(409).send({ error: "Email already registered" });
    if (await getUserByUsername(username)) return reply.code(409).send({ error: "Username taken" });
    const password_hash = await hashPassword(password);
    const user = await createUser({ email, username, password_hash, display_name: displayName || username });
    await ensureProfile(user.id);
    const sessionToken = await createSession(user.id);
    await setUserPresence(user.id, "online", sessionToken);
    setSessionCookie(reply, sessionToken);
    return reply.code(201).send({ user: publicUser(user) });
  }
);

app.post(
  "/api/auth/login",
  { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
  async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Invalid input" });
    const { identifier, password } = p.data;
    const user = await getUserByLogin(identifier);
    const ok = user ? await verifyPassword(user.password_hash, password).catch(() => false) : false;
    if (!user || !ok) return reply.code(401).send({ error: "Invalid credentials" });
    // refuse login for actively banned accounts (expired bans pass through)
    const banned = await checkBanned(user.id);
    if (banned) return reply.code(403).send({ error: banned.message });
    const sessionToken = await createSession(user.id);
    await setUserPresence(user.id, "online", sessionToken);
    setSessionCookie(reply, sessionToken);
    return reply.send({ user: publicUser(user) });
  }
);

app.post("/api/auth/logout", async (req, reply) => {
  const user = await currentUser(req);
  if (user) await setUserPresence(user.id, "offline", null);
  await destroySession(req.cookies[COOKIE]);
  reply.clearCookie(COOKIE, { path: "/" });
  return reply.send({ ok: true });
});

app.get("/api/auth/me", async (req, reply) => {
  return reply.send({ user: publicUser(await currentUser(req)) || null });
});

// ---- admin routes ----
app.get("/api/admin/users", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const rows = await all(
    `SELECT id,email,username,role,display_name,created_at FROM users ORDER BY created_at DESC`
  );
  return reply.send({ users: rows.map(toClient) });
});

app.patch("/api/admin/users/:id/role", async (req, reply) => {
  const admin = await requireAdmin(req, reply);
  if (!admin) return;
  const p = roleSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "role must be 'user' or 'admin'" });
  const target = await getUserById(req.params.id);
  if (!target) return reply.code(404).send({ error: "User not found" });
  // never let the last admin demote themselves out of existence
  if (target.role === "admin" && p.data.role === "user" && (await countAdmins()) <= 1) {
    return reply.code(400).send({ error: "Cannot demote the last admin" });
  }
  await run(`UPDATE users SET role=? WHERE id=?`, [p.data.role, target.id]);
  return reply.send({ ok: true });
});

// ---- admin: bans ----
// List all bans (active + expired), newest first.
app.get("/api/admin/bans", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const rows = await listBans();
  return reply.send({ bans: rows.map(banToClient) });
});

// Ban a user. durationDays null/omitted => permanent. Banning also kills any
// live sessions so the user is booted immediately, not just at next login.
app.post("/api/admin/bans", async (req, reply) => {
  const admin = await requireAdmin(req, reply);
  if (!admin) return;
  const p = banSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Invalid input", details: p.error.flatten() });
  const { userId, reason, durationDays } = p.data;
  const target = await getUserById(userId);
  if (!target) return reply.code(404).send({ error: "User not found" });
  if (target.role === "admin") return reply.code(400).send({ error: "Cannot ban an admin" });
  const expiresAt = durationDays != null ? Date.now() + durationDays * 24 * 60 * 60 * 1000 : null;
  const ban = await banUser(userId, admin.id, reason, expiresAt);
  await run(`DELETE FROM sessions WHERE user_id=?`, [userId]); // revoke active logins
  await setUserPresence(userId, "offline", null).catch(() => {});
  return reply.code(201).send({ ban: banToClient({ ...ban, user_username: target.username, user_display: target.display_name, user_email: target.email, admin_username: admin.username, admin_display: admin.display_name }) });
});

// Lift a ban.
app.delete("/api/admin/bans/:userId", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const existed = await unbanUser(req.params.userId);
  if (!existed) return reply.code(404).send({ error: "No ban found for that user" });
  return reply.send({ ok: true });
});

// ---- profile schemas ----
const profilePatchSchema = z.object({
  bio: z.string().max(280).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  favoriteLeader: z.string().max(20).nullable().optional(),
  supporter: z.boolean().optional(),
  country: z.string().regex(/^([A-Z]{2})?$/).optional(),
});
const cardEntrySchema = z.object({ id: z.string().max(20), count: z.number().int().min(1).max(99) });
const deckCreateSchema = z.object({
  name: z.string().min(1).max(60),
  leaderId: z.string().max(20).nullable().optional(),
  leaderName: z.string().max(80).optional(),
  cards: z.array(cardEntrySchema).max(60).optional(),
  format: z.string().max(20).optional(),
  fav: z.boolean().optional(),
});
const deckPatchSchema = deckCreateSchema.partial();

// ---- profile routes ----
app.get("/api/me/profile", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const profile = await ensureProfile(user.id);
  return reply.send({ user: publicUser(user), profile: profileToClient(profile) });
});

app.patch("/api/me/profile", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const p = profilePatchSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Invalid input", details: p.error.flatten() });
  const fields = {};
  if (p.data.bio !== undefined) fields.bio = p.data.bio;
  if (p.data.avatarColor !== undefined) fields.avatar_color = p.data.avatarColor;
  if (p.data.favoriteLeader !== undefined) fields.favorite_leader = p.data.favoriteLeader;
  if (p.data.supporter !== undefined) fields.supporter = p.data.supporter ? 1 : 0;
  if (p.data.country !== undefined) fields.country = p.data.country;
  const profile = await updateProfile(user.id, fields);
  return reply.send({ profile: profileToClient(profile) });
});

// public profile by username (any logged-in user may view)
app.get("/api/profiles/:username", async (req, reply) => {
  const viewer = await requireUser(req, reply);
  if (!viewer) return;
  const target = await getUserByUsername(req.params.username);
  if (!target) return reply.code(404).send({ error: "User not found" });
  const profile = await ensureProfile(target.id);
  const decks = await listDecks(target.id);
  const { email: _private, ...shownUser } = publicUser(target); // an email is for its owner and admins
  return reply.send({
    user: shownUser,
    profile: profileToClient(profile),
    decks: decks.map(deckSummary),
    social: await followCounts(target.id, viewer.id),
  });
});

// ladder entry, rating history, per-leader stats and recent games of a captain
app.get("/api/profiles/:username/stats", async (req, reply) => {
  if (!(await requireUser(req, reply))) return;
  const target = await getUserByUsername(req.params.username);
  if (!target) return reply.code(404).send({ error: "User not found" });
  return reply.send(await profileStats(target.id));
});

// ---- follows (one-way; friendships stay two-way) ----
async function followCounts(userId, viewerId) {
  const f = await get(`SELECT COUNT(*) AS c FROM follows WHERE followee_id=?`, [userId]);
  const g = await get(`SELECT COUNT(*) AS c FROM follows WHERE follower_id=?`, [userId]);
  const me = await get(`SELECT 1 AS x FROM follows WHERE follower_id=? AND followee_id=?`, [viewerId, userId]);
  return { followers: Number(f.c), following: Number(g.c), isFollowing: !!me };
}
app.post("/api/follows/:username", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const target = await getUserByUsername(req.params.username);
  if (!target) return reply.code(404).send({ error: "User not found" });
  if (target.id === user.id) return reply.code(400).send({ error: "You can't follow yourself" });
  await run(`INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)`, [user.id, target.id, Date.now()]);
  return reply.send({ social: await followCounts(target.id, user.id) });
});
app.delete("/api/follows/:username", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const target = await getUserByUsername(req.params.username);
  if (!target) return reply.code(404).send({ error: "User not found" });
  await run(`DELETE FROM follows WHERE follower_id=? AND followee_id=?`, [user.id, target.id]);
  return reply.send({ social: await followCounts(target.id, user.id) });
});

// directory of captains
app.get("/api/users", async (req, reply) => {
  if (!(await requireUser(req, reply))) return;
  const rows = await all(`
    SELECT u.id, u.username, u.display_name, u.role, u.created_at,
           p.avatar_color, p.favorite_leader, p.supporter, p.wins, p.losses,
           (SELECT COUNT(*) FROM decks d WHERE d.user_id = u.id) AS deck_count
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id
    ORDER BY p.supporter DESC, u.created_at ASC
  `);
  return reply.send({
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      avatarColor: r.avatar_color || "#7a3030",
      favoriteLeader: r.favorite_leader,
      supporter: !!r.supporter,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      deckCount: Number(r.deck_count ?? 0),
      createdAt: r.created_at,
    })),
  });
});

// ---- deck routes ----
app.get("/api/me/decks", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const decks = await listDecks(user.id);
  return reply.send({ decks: decks.map(deckToClient) });
});

app.post("/api/me/decks", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const p = deckCreateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Invalid input", details: p.error.flatten() });
  const deck = await createDeck(user.id, p.data);
  return reply.code(201).send({ deck: deckToClient(deck) });
});

app.get("/api/decks/:id", async (req, reply) => {
  if (!(await requireUser(req, reply))) return;
  const deck = await getDeck(req.params.id);
  if (!deck) return reply.code(404).send({ error: "Deck not found" });
  return reply.send({ deck: deckToClient(deck) });
});

app.patch("/api/decks/:id", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const deck = await getDeck(req.params.id);
  if (!deck) return reply.code(404).send({ error: "Deck not found" });
  if (deck.user_id !== user.id) return reply.code(403).send({ error: "Not your deck" });
  const p = deckPatchSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Invalid input", details: p.error.flatten() });
  const updated = await updateDeck(deck.id, p.data);
  return reply.send({ deck: deckToClient(updated) });
});

app.delete("/api/decks/:id", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const deck = await getDeck(req.params.id);
  if (!deck) return reply.code(404).send({ error: "Deck not found" });
  if (deck.user_id !== user.id) return reply.code(403).send({ error: "Not your deck" });
  await deleteDeck(deck.id);
  return reply.send({ ok: true });
});

// ---- matches / stats ----
app.get("/api/me/matches", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const rows = await listMatches(user.id, 60);
  return reply.send({ matches: rows.map(matchToClient) });
});

// Log a manual match result (no match session required — for local play)
const matchLogSchema = z.object({
  deckId: z.string().min(1),
  result: z.enum(["win", "loss"]),
  onPlay: z.boolean(),
  oppLeaderId: z.string().max(20).nullable().optional(),
  oppUsername: z.string().max(24).nullable().optional(),
  format: z.string().max(20).optional(),
});
app.post("/api/me/matches", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const p = matchLogSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Invalid input", details: p.error.flatten() });
  const { deckId, result, onPlay, oppLeaderId, oppUsername, format } = p.data;
  const deck = await getDeck(deckId);
  if (!deck || deck.user_id !== user.id) return reply.code(404).send({ error: "Deck not found" });
  const oppUser = oppUsername ? await getUserByUsername(oppUsername) : null;
  const match = await createMatch({
    userId: user.id,
    oppUserId: oppUser?.id ?? null,
    myDeckId: deck.id,
    myLeaderId: deck.leader_id,
    oppLeaderId: oppLeaderId ?? null,
    result,
    onPlay,
    format: format || deck.format || "",
  });
  return reply.code(201).send({ match: matchToClient(match) });
});

// per-deck aggregates (overall + on-the-play/draw + per-opponent-leader) for My Statistics
app.get("/api/me/stats", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const decks = await listDecks(user.id);
  const days = Math.max(0, parseInt(req.query.days || 0) || 0);
  const since = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const matches = (await allMatches(user.id)).filter((m) => Number(m.created_at) >= since);

  const byDeck = new Map();
  for (const d of decks) {
    byDeck.set(d.id, {
      deckId: d.id,
      name: d.name,
      leaderId: d.leader_id,
      leaderName: d.leader_name,
      format: d.format,
      games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0,
      _mu: new Map(),
    });
  }
  for (const m of matches) {
    const d = byDeck.get(m.my_deck_id);
    if (!d) continue;
    const win = m.result === "win";
    d.games++; if (win) d.wins++;
    if (m.on_play) { d.games1++; if (win) d.wins1++; }
    else { d.games2++; if (win) d.wins2++; }
    const k = m.opp_leader_id || "?";
    const mu = d._mu.get(k) || { oppLeaderId: k, games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0 };
    mu.games++; if (win) mu.wins++;
    if (m.on_play) { mu.games1++; if (win) mu.wins1++; } else { mu.games2++; if (win) mu.wins2++; }
    d._mu.set(k, mu);
  }
  const out = [...byDeck.values()].map((d) => ({
    deckId: d.deckId, name: d.name, leaderId: d.leaderId, leaderName: d.leaderName, format: d.format,
    games: d.games, wins: d.wins, games1: d.games1, wins1: d.wins1, games2: d.games2, wins2: d.wins2,
    matchups: [...d._mu.values()].sort((a, b) => b.games - a.games),
  }));
  return reply.send({ decks: out });
});

// ---- friends ----
app.get("/api/me/friends", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const rows = await listFriends(user.id);
  return reply.send({ friends: rows.map(friendshipToClient) });
});

const msgBody = z.object({ body: z.string().min(1).max(1000) });

app.post("/api/me/friends/:username", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const target = await getUserByUsername(req.params.username);
  if (!target) return reply.code(404).send({ error: "User not found" });
  if (target.id === user.id) return reply.code(400).send({ error: "Cannot friend yourself" });
  try {
    const f = await sendFriendRequest(user.id, target.id);
    // notify the addressee (unless this call auto-accepted a reciprocal request)
    if (f.status === "pending") {
      await createNotification({ userId: target.id, type: "friend_request", actorId: user.id, body: `${user.display_name} sent you a friend request`, ref: user.username });
    } else if (f.status === "accepted") {
      await createNotification({ userId: target.id, type: "friend_accept", actorId: user.id, body: `You and ${user.display_name} are now friends`, ref: user.username });
    }
    return reply.send({ ok: true, friendship: { id: f.id, status: f.status } });
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

app.patch("/api/me/friends/:id", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const p = z.object({ action: z.enum(["accept", "decline", "remove"]) }).safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "action must be accept/decline/remove" });
  try {
    if (p.data.action === "accept") {
      const f = await acceptFriend(user.id, req.params.id);
      // notify the original requester that it was accepted
      if (f?.requester_id) {
        await createNotification({ userId: f.requester_id, type: "friend_accept", actorId: user.id, body: `${user.display_name} accepted your friend request`, ref: user.username });
      }
    } else {
      await deleteFriendship(user.id, req.params.id);
    }
    return reply.send({ ok: true });
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// ---- messages ----
app.get("/api/me/threads", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const rows = await listThreads(user.id);
  return reply.send({
    threads: rows.map((t) => ({
      ...threadToClient(t),
      lastFromMe: t.last_from === user.id,
    })),
  });
});

app.get("/api/threads/:username", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const peer = await getUserByUsername(req.params.username);
  if (!peer) return reply.code(404).send({ error: "User not found" });
  const rows = await listMessagesWith(user.id, peer.id, 200);
  await markThreadRead(user.id, peer.id);
  return reply.send({
    peer: { id: peer.id, username: peer.username, displayName: peer.display_name },
    messages: rows.map((m) => messageToClient(m, user.id)),
  });
});

app.post("/api/threads/:username", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const p = msgBody.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Body must be 1–1000 chars" });
  const peer = await getUserByUsername(req.params.username);
  if (!peer) return reply.code(404).send({ error: "User not found" });
  if (peer.id === user.id) return reply.code(400).send({ error: "Cannot message yourself" });
  const m = await sendMessage(user.id, peer.id, p.data.body);
  await createNotification({ userId: peer.id, type: "message", actorId: user.id, body: `${user.display_name}: ${p.data.body.slice(0, 60)}`, ref: user.username });
  return reply.code(201).send({ message: messageToClient(m, user.id) });
});

app.post("/api/threads/:username/read", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const peer = await getUserByUsername(req.params.username);
  if (!peer) return reply.code(404).send({ error: "User not found" });
  await markThreadRead(user.id, peer.id);
  return reply.send({ ok: true });
});

// ---- presence ----
app.get("/api/me/presence", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const pres = await getUserPresence(user.id);
  return reply.send(effectivePresence(pres));
});

app.patch("/api/me/presence", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const p = presenceSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: "Invalid status" });
  const pres = await setUserPresence(user.id, p.data.status);
  return reply.send(presenceToClient(pres));
});

app.get("/api/friends/presence", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const presences = await getPresenceOfFriends(user.id);
  return reply.send(presences);
});

// public lightweight counts for the landing/home (no auth)
app.get("/api/stats", async () => {
  const u = await get(`SELECT COUNT(*) AS c FROM users`);
  const d = await get(`SELECT COUNT(*) AS c FROM decks`);
  const m = await get(`SELECT COUNT(*) AS c FROM matches`);
  return { captains: Number(u.c), decks: Number(d.c), matches: Number(m.c) };
});

app.get("/api/health", async () => ({ ok: true }));

// ---- card art proxy (same-origin, disk-cached; see card-art.mjs) ----
registerCardArt(app);
await registerWelcome(app);

// ---- card catalog (our own DB; seeded by server/seed-cards.mjs) ----
// Maps a `cards` row to the frontend Card shape (parse JSON cols, set_code->set).
const cardRowToClient = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  colors: JSON.parse(r.colors || "[]"),
  cost: r.cost,
  power: r.power,
  counter: r.counter,
  types: JSON.parse(r.types || "[]"),
  attributes: JSON.parse(r.attributes || "[]"),
  effect: r.effect,
  trigger: r.trigger,
  rarity: r.rarity,
  set: r.set_code,
  image: r.image,
  imageOfficial: r.image_official,
});

app.get("/api/cards", async (req, reply) => {
  const rows = await all(`SELECT * FROM cards`);
  // Sort by set, then by the numeric part of the id (matches build-cards.mjs).
  rows.sort((a, b) =>
    a.set_code !== b.set_code
      ? a.set_code < b.set_code ? -1 : 1
      : Number(a.id.split("-")[1]) - Number(b.id.split("-")[1])
  );
  // revalidate every load: after `npm run seed:cards` the new sets must show up at once
  // (an hour of max-age kept serving the old catalog — "unknown card OP17-089")
  reply.header("Cache-Control", "no-cache");
  return reply.send({ cards: rows.map(cardRowToClient) });
});

app.get("/api/cards/:id", async (req, reply) => {
  const row = await get(`SELECT * FROM cards WHERE id=?`, [req.params.id]);
  if (!row) return reply.code(404).send({ error: "Card not found" });
  return reply.send({ card: cardRowToClient(row) });
});

// ---- match system (v3) ----
// The deckId of a request, if that deck is the user's: a result counts on the deck
// that played, so nobody may queue with someone else's. Otherwise replies and returns null.
async function ownDeckId(req, reply, user) {
  const deckId = req.body?.deckId;
  if (!deckId) { reply.code(400).send({ error: "deckId required" }); return null; }
  const deck = await getDeck(deckId);
  if (!deck || deck.user_id !== user.id) { reply.code(404).send({ error: "Deck not found" }); return null; }
  return deckId;
}

app.post("/api/me/match-sessions/create", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const deckId = await ownDeckId(req, reply, user);
  if (!deckId) return;

  const session = await createMatchSession(user.id, deckId);
  await setUserPresence(user.id, "in_duel");
  return reply.code(201).send({ session: matchSessionToClient(session) });
});

app.post("/api/match-sessions/:sessionId/join", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const { sessionId } = req.params;
  const deckId = await ownDeckId(req, reply, user);
  if (!deckId) return;

  const session = await joinMatchSession(sessionId, user.id, deckId);
  if (!session) return reply.code(404).send({ error: "Match not available" });

  await setUserPresence(user.id, "in_duel");
  return reply.send({ session: matchSessionToClient(session) });
});

app.get("/api/match-sessions/active", async (req, reply) => {
  const matches = await listActiveMatches();
  return reply.send({ sessions: matches.map(matchSessionToClient) });
});

app.get("/api/me/match-sessions", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;

  const matches = await getUserMatches(user.id);
  return reply.send({ sessions: matches.map(matchSessionToClient) });
});

app.get("/api/match-sessions/:sessionId", async (req, reply) => {
  const session = await getMatchSession(req.params.sessionId);
  if (!session) return reply.code(404).send({ error: "Match not found" });
  return reply.send({ session: matchSessionToClient(session) });
});

app.post("/api/match-sessions/:sessionId/complete", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const winnerId = req.body?.winnerId;
  if (!winnerId) return reply.code(400).send({ error: "winnerId required" });

  const session = await getMatchSession(req.params.sessionId);
  if (!session) return reply.code(404).send({ error: "Match not found" });
  if (session.status !== "active") return reply.code(400).send({ error: "Match not active" });

  // Verify user is part of this match
  if (user.id !== session.host_user_id && user.id !== session.opponent_id) {
    return reply.code(403).send({ error: "Not in this match" });
  }
  if (winnerId !== session.host_user_id && winnerId !== session.opponent_id) {
    return reply.code(400).send({ error: "Winner is not in this match" });
  }

  const updated = await reportMatchResult(session, user.id, winnerId);
  if (updated.status !== "active") {
    await setUserPresence(session.host_user_id, "online");
    if (session.opponent_id) await setUserPresence(session.opponent_id, "online");
  }

  return reply.send({ session: matchSessionToClient(updated) });
});

app.post("/api/match-sessions/:sessionId/cancel", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const session = await getMatchSession(req.params.sessionId);
  if (!session) return reply.code(404).send({ error: "Match not found" });
  if (user.id !== session.host_user_id && user.id !== session.opponent_id) {
    return reply.code(403).send({ error: "Not in this match" });
  }

  const updated = await cancelMatchSession(req.params.sessionId);
  await setUserPresence(session.host_user_id, "online");
  if (session.opponent_id) await setUserPresence(session.opponent_id, "online");

  return reply.send({ session: matchSessionToClient(updated) });
});

// ---- ranked queue ----
app.post("/api/me/queue/join", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const deckId = await ownDeckId(req, reply, user);
  if (!deckId) return;

  await joinQueue(user.id, deckId, await ladderRating(user.id));
  await setUserPresence(user.id, "online");

  return reply.send({ ok: true });
});

app.post("/api/me/queue/leave", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;

  await leaveQueue(user.id);
  return reply.send({ ok: true });
});

app.get("/api/queue", async (req, reply) => {
  const players = await getQueuedPlayers();
  return reply.send({ players });
});

// Status for the current user's matchmaking: idle / waiting / matched.
// The frontend polls this; when status flips to "matched" it loads the match
// (which calls /ready, flipping the session pending -> active).
app.get("/api/me/queue/status", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;

  const s = await getQueueStatus(user.id);

  if (s.state === "matched") {
    const ms = s.session;
    const opponentUsername =
      ms.host_user_id === user.id ? ms.opp_username : ms.host_username;
    return reply.send({
      status: "matched",
      sessionId: ms.id,
      opponentUsername: opponentUsername || null,
      startNow: true,
    });
  }

  if (s.state === "waiting") {
    return reply.send({
      status: "waiting",
      position: s.position,
      estimatedWait: estimateWaitLabel(s.position - 1),
    });
  }

  return reply.send({ status: "idle" });
});

// Confirm presence for a pending match (frontend calls this when it loads the
// match screen). Once both players confirm, the session goes 'active'.
app.post("/api/me/queue/ready", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const { sessionId } = req.body || {};
  if (!sessionId) return reply.code(400).send({ error: "sessionId required" });

  const session = await markMatchReady(sessionId, user.id);
  if (!session) return reply.code(404).send({ error: "Match not found" });
  await setUserPresence(user.id, "in_duel");
  return reply.send({ session: matchSessionToClient(session) });
});

// Manual matchmaking tick — runs one pairing pass + expires no-shows. The same
// work runs automatically every 5s (see setInterval below); this endpoint lets
// the frontend (or curl/tests) force a pass without waiting for the timer.
app.post("/api/queue/tick", async (req, reply) => {
  const result = await runMatchmakingTick();
  return reply.send(result);
});

// ---- leaderboard ----
// Season ladder built from the match history (server/stats). Filters: ?leader=OP11-041&country=IT
app.get("/api/leaderboard", async (req, reply) => {
  const limit = Math.min(parseInt(req.query.limit || 100) || 100, 1000);
  const leader = typeof req.query.leader === "string" ? req.query.leader.slice(0, 20) : "";
  const country = typeof req.query.country === "string" ? req.query.country.slice(0, 2).toUpperCase() : "";
  return reply.send(await ladderBoard({ leader, country, limit }));
});

// ---- global chat ----
const chatSchema = z.object({ body: z.string().min(1).max(500) });

app.get("/api/chat", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const rows = await listGlobalMessages(80);
  return reply.send({ messages: rows.map((m) => globalMessageToClient(m, user.id)) });
});

app.post(
  "/api/chat",
  { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const p = chatSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Message must be 1–500 chars" });
    const m = await postGlobalMessage(user.id, p.data.body);
    return reply.code(201).send({ ok: true, id: m.id });
  }
);

// ---- notifications ----
app.get("/api/me/notifications", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const rows = await listNotifications(user.id, 40);
  const unread = await countUnreadNotifications(user.id);
  return reply.send({ notifications: rows.map(notificationToClient), unread });
});

app.post("/api/me/notifications/read", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  await markNotificationsRead(user.id);
  return reply.send({ ok: true });
});

// ---- meta analytics (global, from real match history) ----
// Meta Analytics page: matchup grid + best lists.
// ?format=OP15 · ?from=&to= (ms) · ?minBounty=&maxBounty= (Berries, the player's Bounty going into the game)
app.get("/api/meta/report", async (req, reply) => {
  if (!(await requireUser(req, reply))) return;
  const q = req.query || {};
  const num = (v) => (v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return reply.send(await metaReport({
    format: typeof q.format === "string" ? q.format.slice(0, 30) : "",
    from: num(q.from),
    to: num(q.to),
    minBounty: num(q.minBounty),
    maxBounty: num(q.maxBounty),
  }));
});

// ?days=7|30|0 (0 = all time) · ?min= minimum games for a leader to be "enough" data
app.get("/api/meta", async (req, reply) => {
  if (!(await requireUser(req, reply))) return;
  const days = Math.max(0, Math.min(365, parseInt(req.query.days || 0) || 0));
  const min = req.query.min !== undefined ? Math.max(1, parseInt(req.query.min) || 1) : undefined;
  return reply.send(await metaStats({ days, ...(min ? { minGames: min } : {}) }));
});

// ---- consolidated polling: one call for all the badges ----
app.get("/api/me/sync", async (req, reply) => {
  const user = await requireUser(req, reply);
  if (!user) return;
  const [pres, threads, friends, unreadNotifs] = await Promise.all([
    getUserPresence(user.id),
    listThreads(user.id),
    listFriends(user.id),
    countUnreadNotifications(user.id),
  ]);
  return reply.send({
    presence: effectivePresence(pres),
    unreadMessages: threads.reduce((a, t) => a + Number(t.unread || 0), 0),
    incomingRequests: friends.filter((f) => f.status === "pending" && f.role === "incoming").length,
    unreadNotifications: unreadNotifs,
  });
});

// ---- matchmaking trigger ----
// Simplest pattern with no game engine: an in-process timer runs one pairing
// pass every 5s. `unref()` keeps it from holding the process open on shutdown.
// MATCHMAKING_OFF=1 disables it (useful in tests that drive /api/queue/tick).
const MATCHMAKING_INTERVAL_MS = 5000;
if (process.env.MATCHMAKING_OFF !== "1") {
  const timer = setInterval(runMatchmakingTick, MATCHMAKING_INTERVAL_MS);
  timer.unref();
}

app
  .listen({ port: PORT, host: "127.0.0.1" })
  .then(() => console.log(`Sailing Network API → http://localhost:${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
