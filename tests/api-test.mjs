// api-test.mjs — integration tests for the Sailing Network API.
// Boots an ISOLATED server (own port + temp SQLite DB) so the real data is
// never touched, runs the suite with plain fetch, then tears everything down.
//
//   npm run test:api
//
// Exit code 0 = all green, 1 = failures (suitable for CI).

import { spawn } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(__dirname, "api-test.db");

// ---------- tiny test harness ----------
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}
const section = (t) => console.log(`\n— ${t} —`);

// ---------- cookie-aware client (one jar per user) ----------
function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/sn_session=([^;]*)/);
      if (m) cookie = m[1] ? `sn_session=${m[1]}` : "";
    }
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b ?? {}),
    patch: (p, b) => call("PATCH", p, b),
    del: (p) => call("DELETE", p),
  };
}

// ---------- boot isolated server ----------
function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB + suffix;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

async function waitForHealth(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

cleanupDb();

// seed the first admin into the temp DB, then boot the server on the test port
const env = { ...process.env, SN_API_PORT: String(PORT), SN_DB_PATH: DB };
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(ROOT, "server", "seed-admin.mjs")], { env, stdio: "ignore" });
  p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("seed-admin failed"))));
});

const server = spawn(process.execPath, [join(ROOT, "server", "index.mjs")], { env, stdio: "ignore" });
const up = await waitForHealth();
if (!up) {
  server.kill();
  cleanupDb();
  console.error("Server did not come up on the test port.");
  process.exit(1);
}

try {
  // ============================ AUTH ============================
  section("auth");
  const u1 = client();
  let r = await u1.post("/api/auth/signup", { email: "u1@test.local", username: "tester_one", password: "password123" });
  check("signup returns 201 + user", r.status === 201 && r.json?.user?.username === "tester_one");

  r = await u1.get("/api/auth/me");
  check("session cookie works (/me)", r.status === 200 && r.json?.user?.username === "tester_one");

  r = await client().post("/api/auth/signup", { email: "x@test.local", username: "tester_one", password: "password123" });
  check("duplicate username → 409", r.status === 409);

  r = await client().post("/api/auth/signup", { email: "y@test.local", username: "shorty", password: "123" });
  check("weak password → 400", r.status === 400);

  r = await client().post("/api/auth/login", { identifier: "tester_one", password: "wrong" });
  check("wrong password → 401", r.status === 401);

  r = await u1.post("/api/auth/logout");
  check("logout ok", r.status === 200);
  r = await u1.get("/api/auth/me");
  check("after logout /me → null", r.json?.user === null);

  r = await u1.post("/api/auth/login", { identifier: "tester_one", password: "password123" });
  check("re-login by username", r.status === 200);

  const u2 = client();
  await u2.post("/api/auth/signup", { email: "u2@test.local", username: "tester_two", password: "password123" });

  const admin = client();
  r = await admin.post("/api/auth/login", { identifier: "admin", password: "admin12345" });
  check("admin login", r.status === 200 && r.json?.user?.role === "admin");

  // ============================ BANS ============================
  section("bans");
  const u1Id = (await u1.get("/api/auth/me")).json.user.id;

  r = await u1.get("/api/admin/bans");
  check("non-admin cannot list bans → 403", r.status === 403);

  r = await admin.post("/api/admin/bans", { userId: u1Id, reason: "test ban" });
  check("admin bans user → 201", r.status === 201);

  r = await client().post("/api/auth/login", { identifier: "tester_one", password: "password123" });
  check("banned user cannot log in → 403 + reason", r.status === 403 && /test ban/.test(r.json?.error || ""));

  const adminId = (await admin.get("/api/auth/me")).json.user.id;
  r = await admin.post("/api/admin/bans", { userId: adminId, reason: "nope" });
  check("cannot ban an admin → 400", r.status === 400);

  r = await admin.del(`/api/admin/bans/${u1Id}`);
  check("unban → 200", r.status === 200);

  r = await u1.post("/api/auth/login", { identifier: "tester_one", password: "password123" });
  check("unbanned user can log in again", r.status === 200);

  // ============================ DECKS ============================
  section("decks");
  r = await u1.post("/api/me/decks", { name: "Test Deck", leaderId: "OP01-001", leaderName: "Zoro", cards: [{ id: "OP01-016", count: 4 }] });
  check("create deck → 201", r.status === 201 && r.json?.deck?.name === "Test Deck");
  const deckId = r.json.deck.id;

  r = await u2.patch(`/api/decks/${deckId}`, { name: "hacked" });
  check("PATCH another user's deck → 403", r.status === 403);
  r = await u2.del(`/api/decks/${deckId}`);
  check("DELETE another user's deck → 403", r.status === 403);

  r = await u1.patch(`/api/decks/${deckId}`, { name: "Renamed Deck" });
  check("owner rename → 200", r.status === 200 && r.json?.deck?.name === "Renamed Deck");

  r = await u1.post("/api/me/decks", { name: "bad", cards: [{ id: "X", count: 0 }] });
  check("invalid card count → 400", r.status === 400);

  // ============================ FRIENDS ============================
  section("friends");
  r = await u1.post("/api/me/friends/tester_two");
  check("send friend request", r.status === 200 && r.json?.friendship?.status === "pending");

  r = await u2.get("/api/me/friends");
  const incoming = (r.json?.friends || []).find((f) => f.role === "incoming" && f.status === "pending");
  check("recipient sees incoming request", !!incoming);

  r = await u2.patch(`/api/me/friends/${incoming.id}`, { action: "accept" });
  check("accept request", r.status === 200);

  r = await u1.get("/api/me/friends");
  check("both sides now accepted", (r.json?.friends || []).some((f) => f.status === "accepted"));

  r = await u1.post("/api/me/friends/tester_one");
  check("cannot friend yourself → 400", r.status === 400);

  // ============================ MESSAGES ============================
  section("messages");
  r = await u1.post("/api/threads/tester_two", { body: "ciao dal test" });
  check("send DM → 201", r.status === 201);

  r = await u2.get("/api/me/threads");
  const th = (r.json?.threads || []).find((t) => t.peer.username === "tester_one");
  check("recipient thread shows unread=1", th?.unread === 1 && th?.lastBody === "ciao dal test");

  r = await u2.get("/api/threads/tester_one");
  check("opening thread returns the message", (r.json?.messages || []).some((m) => m.body === "ciao dal test" && !m.fromMe));

  r = await u2.get("/api/me/threads");
  check("thread marked read after opening", (r.json?.threads || []).find((t) => t.peer.username === "tester_one")?.unread === 0);

  r = await u1.post("/api/threads/tester_one", { body: "self" });
  check("cannot message yourself → 400", r.status === 400);

  // ============================ NOTIFICATIONS / SYNC / CHAT ============================
  section("notifications, sync, chat");
  r = await u2.get("/api/me/notifications");
  const types = (r.json?.notifications || []).map((n) => n.type);
  check("u2 got friend_request + message notifications", types.includes("friend_request") && types.includes("message"));

  r = await u2.post("/api/me/notifications/read");
  check("mark notifications read", r.status === 200);
  r = await u2.get("/api/me/notifications");
  check("unread notifications now 0", r.json?.unread === 0);

  r = await u1.get("/api/me/sync");
  check("sync returns the badge bundle", r.status === 200 &&
    ["presence", "unreadMessages", "incomingRequests", "unreadNotifications"].every((k) => k in (r.json || {})));

  r = await u1.post("/api/chat", { body: "hello crew" });
  check("post global chat → 201", r.status === 201);
  r = await u2.get("/api/chat");
  check("chat visible to others", (r.json?.messages || []).some((m) => m.body === "hello crew"));

  // ============================ PRESENCE / GUARDS ============================
  section("presence & guards");
  r = await u1.get("/api/me/presence");
  check("presence online after login", r.status === 200 && r.json?.status === "online");

  // ============================ RANKED QUEUE ============================
  section("ranked queue");
  const rankedA = client(), rankedB = client();
  const signup = async (c, name) => (await c.post("/api/auth/signup", { email: `${name}@test.local`, username: name, password: "password123" })).json.user;
  const ua = await signup(rankedA, "ranked_a"), ub = await signup(rankedB, "ranked_b");
  const deckOf = async (c, leaderId) => (await c.post("/api/me/decks", { name: leaderId, leaderId, cards: [], format: "OP17" })).json.deck.id;
  const da = await deckOf(rankedA, "OP14-020"), db = await deckOf(rankedB, "OP15-058");
  await rankedA.post("/api/me/queue/join", { deckId: da });
  await rankedB.post("/api/me/queue/join", { deckId: db });
  await rankedA.post("/api/queue/tick");
  r = await rankedA.get("/api/me/queue/status");
  check("queue pairs the two players", r.json?.status === "matched" && r.json?.opponentUsername === "ranked_b", JSON.stringify(r.json));
  const sid = r.json?.sessionId;
  await rankedA.post("/api/me/queue/ready", { sessionId: sid });
  r = await rankedB.post("/api/me/queue/ready", { sessionId: sid });
  check("both ready → active", r.json?.session?.status === "active");
  r = await rankedA.post(`/api/match-sessions/${sid}/complete`, { winnerId: "someone-else" });
  check("winner outside the match → 400", r.status === 400);
  r = await rankedB.post(`/api/match-sessions/${sid}/complete`, { winnerId: ub.id });
  check("one report alone counts for nothing", r.json?.session?.status === "active" && (await rankedB.get("/api/me/matches")).json.matches.length === 0);
  r = await rankedA.post(`/api/match-sessions/${sid}/complete`, { winnerId: ub.id });
  check("both reports agree → completed", r.json?.session?.status === "completed");
  r = await rankedB.post(`/api/match-sessions/${sid}/complete`, { winnerId: ub.id });
  check("report on a finished game refused", r.status === 400);
  const ma = (await rankedA.get("/api/me/matches")).json.matches, mb = (await rankedB.get("/api/me/matches")).json.matches;
  check("one match row each, with the right result", ma.length === 1 && mb.length === 1 && ma[0].result === "loss" && mb[0].result === "win", JSON.stringify([ma, mb]));

  await rankedA.post("/api/me/queue/join", { deckId: da });
  await rankedB.post("/api/me/queue/join", { deckId: db });
  const queued = (await rankedA.get("/api/queue")).json.players;
  const ratingIn = (id) => queued.find((p) => p.user_id === id)?.rating;
  check("the queue pairs on the ladder rating", ratingIn(ub.id) > 1500 && ratingIn(ua.id) < 1500, JSON.stringify(queued));
  await rankedA.post("/api/queue/tick");
  check("too far apart in rating: no pair yet", (await rankedA.get("/api/me/queue/status")).json?.status === "waiting");
  await rankedB.post("/api/me/queue/leave");
  const rankedC = client();
  await signup(rankedC, "ranked_c");
  await rankedC.post("/api/me/queue/join", { deckId: await deckOf(rankedC, "OP13-004") });
  await rankedA.post("/api/queue/tick");
  const sid2 = (await rankedA.get("/api/me/queue/status")).json?.sessionId;
  r = await rankedA.post(`/api/match-sessions/${sid2}/cancel`);
  check("cancel closes the match", r.json?.session?.status === "cancelled");
  check("a cancelled game writes no row", (await rankedA.get("/api/me/matches")).json.matches.length === 1);
  check("cancel frees the player", (await rankedA.get("/api/me/queue/status")).json?.status === "idle");

  // both claim the win: no result
  const dc = (await rankedC.get("/api/me/decks")).json.decks[0].id;
  const uc = (await rankedC.get("/api/auth/me")).json.user;
  await rankedA.post("/api/me/queue/join", { deckId: da });
  await rankedC.post("/api/me/queue/join", { deckId: dc });
  await rankedA.post("/api/queue/tick");
  const sid3 = (await rankedA.get("/api/me/queue/status")).json?.sessionId;
  await rankedA.post("/api/me/queue/ready", { sessionId: sid3 });
  await rankedC.post("/api/me/queue/ready", { sessionId: sid3 });
  await rankedA.post(`/api/match-sessions/${sid3}/complete`, { winnerId: ua.id });
  r = await rankedC.post(`/api/match-sessions/${sid3}/complete`, { winnerId: uc.id });
  check("reports disagree → cancelled, no result", r.json?.session?.status === "cancelled" && (await rankedC.get("/api/me/matches")).json.matches.length === 0);

  // an abandoned game frees its players
  await rankedA.post("/api/me/queue/join", { deckId: da });
  await rankedC.post("/api/me/queue/join", { deckId: dc });
  await rankedA.post("/api/queue/tick");
  const sid4 = (await rankedA.get("/api/me/queue/status")).json?.sessionId;
  await rankedA.post("/api/me/queue/ready", { sessionId: sid4 });
  await rankedC.post("/api/me/queue/ready", { sessionId: sid4 });
  const testDb = createClient({ url: pathToFileURL(DB).href });
  await testDb.execute({ sql: `UPDATE match_sessions SET started_at=? WHERE id=?`, args: [Date.now() - 3 * 60 * 60 * 1000, sid4] });
  testDb.close();
  await rankedA.post("/api/queue/tick");
  check("a game abandoned for hours expires", (await rankedA.get("/api/me/queue/status")).json?.status === "idle");

  // a win logged by hand doesn't move the rating
  await rankedC.post("/api/me/matches", { deckId: dc, result: "win", onPlay: true, oppUsername: "ranked_b" });
  check("a logged win stays in the player's records", (await rankedC.get("/api/me/matches")).json.matches.length === 1);
  await rankedC.post("/api/me/queue/join", { deckId: dc });
  check("a logged win doesn't move the rating", (await rankedC.get("/api/queue")).json.players.find((p) => p.user_id === uc.id)?.rating === 1500);
  await rankedC.post("/api/me/queue/leave");

  r = await rankedA.post("/api/me/queue/join", { deckId: db });
  check("queueing with someone else's deck → 404", r.status === 404);

  r = await rankedA.get("/api/profiles/ranked_b");
  check("a profile doesn't show its owner's email", r.status === 200 && r.json?.user?.username === "ranked_b" && !("email" in r.json.user));
  check("your own account still has your email", (await rankedA.get("/api/me/profile")).json?.user?.email === "ranked_a@test.local");

  r = await client().get("/api/me/decks");
  check("anonymous → 401", r.status === 401);

  r = await u1.get("/api/admin/users");
  check("non-admin on admin route → 403", r.status === 403);

  r = await client().get("/api/stats");
  check("public stats reachable without auth", r.status === 200 && typeof r.json?.captains === "number");
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  cleanupDb();
}

console.log(`\n${"=".repeat(40)}\nRESULT: ${passed} passed, ${failed} failed`);
if (failed) console.log("Failed: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
