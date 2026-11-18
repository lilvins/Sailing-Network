// api-test.mjs — integration tests for the Sailing Network API.
// Boots an ISOLATED server (own port + temp SQLite DB) so the real data is
// never touched, runs the suite with plain fetch, then tears everything down.
//
//   npm run test:api
//
// Exit code 0 = all green, 1 = failures (suitable for CI).

import { spawn } from "node:child_process";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(__dirname, "api-test.db");
/** Every mail the test server "sends" lands here, one JSON object per line (SN_MAIL_OUTBOX). */
const OUTBOX = join(__dirname, "api-test.outbox");

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
    del: (p, b) => call("DELETE", p, b),
  };
}

// ---------- boot isolated server ----------
function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB + suffix;
    // Windows keeps the file locked for a moment after the server exits: retry
    if (existsSync(f)) rmSync(f, { force: true, maxRetries: 20, retryDelay: 100 });
  }
  rmSync(OUTBOX, { force: true });
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
// SN_RANKED_GONE_MS: how long a player may stop asking for a ranked table before they have left it
const env = { ...process.env, SN_API_PORT: String(PORT), SN_DB_PATH: DB, SN_RANKED: "open", SN_RANKED_GONE_MS: "2000", SN_MAIL_OUTBOX: OUTBOX, SN_PUBLIC_URL: "http://site.test" };
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(ROOT, "server", "seed-admin.mjs")], { env, stdio: "ignore" });
  p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("seed-admin failed"))));
});
// the card catalog: the server deals ranked games with the rules engine, which reads it
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(ROOT, "server", "seed-cards.mjs")], { env, stdio: "ignore" });
  p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("seed-cards failed"))));
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
  // The players of this section say themselves who won: only the bots of the ladder script
  // may (people play on a table the server judges, see "ranked table" below).
  const asBots = async (...names) => {
    const direct = createClient({ url: pathToFileURL(DB).href });
    await direct.execute({ sql: `UPDATE users SET is_bot=1 WHERE username IN (${names.map(() => "?").join(",")})`, args: names });
    direct.close();
  };
  await asBots("ranked_a", "ranked_b");
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
  await asBots("ranked_c");
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

  // ============================ FRIEND GAMES ============================
  section("friend games");
  const host = client();
  const guest = client();
  await host.post("/api/auth/signup", { email: "host@test.local", username: "room_host", password: "password123" });
  await guest.post("/api/auth/signup", { email: "guest@test.local", username: "room_guest", password: "password123" });
  const deckFor = (name) => ({ name, leaderId: "OP01-001", main: Array(50).fill("OP01-016") });
  const myDeck = (await host.post("/api/me/decks", { name: "Host deck", leaderId: "OP01-001", cards: [] })).json.deck;
  const hosted = (await host.post("/api/rooms", { deck: { ...deckFor("H"), deckId: myDeck.id }, format: "Standard · OP17", type: "BO1" })).json.room;
  check("a hosted duel has a code", /^[A-Z2-9]{6}$/.test(hosted.code));
  r = await guest.post(`/api/rooms/${hosted.code}/join`, { deck: { ...deckFor("G"), deckId: myDeck.id } });
  check("joins by code", r.status === 200 && r.json.room.mySeat === "seatB");
  const recordsOf = async (c) => (await c.get("/api/me/matches")).json.matches;

  r = await host.post(`/api/rooms/${hosted.code}/result`, { winner: "seatA" });
  check("one report records nothing", r.json.recorded === false && (await recordsOf(host)).length === 0);
  r = await guest.post(`/api/rooms/${hosted.code}/result`, { winner: "seatA" });
  check("both agree → recorded", r.json.recorded === true);
  const hostRows = await recordsOf(host);
  const guestRows = await recordsOf(guest);
  check("a row each, with the result of each", hostRows.length === 1 && guestRows.length === 1 && hostRows[0].result === "win" && guestRows[0].result === "loss");
  check("the host's deck counts, not someone else's", (await host.get(`/api/decks/${myDeck.id}`)).json.deck.wins === 1);
  await host.post(`/api/rooms/${hosted.code}/result`, { winner: "seatA" });
  check("reporting again adds nothing", (await recordsOf(host)).length === 1);

  r = await host.post(`/api/rooms/${hosted.code}/rematch`, { action: "request" });
  let seen = (await guest.get(`/api/rooms/${hosted.code}`)).json.room;
  check("one rematch request: no new room", r.status === 200 && seen.rematchVotes.join() === "seatA" && seen.nextCode === null);
  await guest.post(`/api/rooms/${hosted.code}/rematch`, { action: "request" });
  seen = (await host.get(`/api/rooms/${hosted.code}`)).json.room;
  check("both asked: a new room", !!seen.nextCode && seen.nextCode !== hosted.code);
  const again = (await guest.get(`/api/rooms/${seen.nextCode}`)).json.room;
  check("same seats, no moves", again.status === "playing" && again.mySeat === "seatB" && again.total === 0 && again.seats[0].deck.name === "H");

  const other = (await host.post("/api/rooms", { deck: deckFor("H"), format: "East Blue", type: "BO1" })).json.room;
  await guest.post(`/api/rooms/${other.code}/join`, { deck: deckFor("G") });
  await host.post(`/api/rooms/${other.code}/result`, { winner: "seatA" });
  r = await guest.post(`/api/rooms/${other.code}/result`, { winner: "seatB" });
  check("different winners → not recorded", r.json.recorded === false);
  await guest.post(`/api/rooms/${other.code}/rematch`, { action: "leave" });
  r = await host.post(`/api/rooms/${other.code}/rematch`, { action: "request" });
  check("no rematch once the other has left", r.status === 409);

  // ============================ REPLAYS ============================
  section("replays");
  // the server does not run the engine: a record only has to line up (plays, prompts, log)
  const recordOf = (moves, { names = ["A", "B"], ai = false, over = true } = {}) => {
    const events = [{ type: "gameStarted" }, { type: "turnStarted", turn: 1, player: "seatA" }, { type: "turnStarted", turn: 2, player: "seatB" }];
    if (over) events.push({ type: "gameEnded", winner: "seatB", reason: "concede" });
    return {
      v: 1,
      seats: [
        { pid: "seatA", name: names[0], controller: "human", deckName: "Deck A", leaderId: "OP01-001" },
        { pid: "seatB", name: names[1], controller: ai ? "ai" : "human", deckName: "Deck B", leaderId: "OP01-002" },
      ],
      initial: { players: { seatA: {}, seatB: {} }, order: ["seatB", "seatA"] },
      events,
      cuts: [1, ...moves.map((_, i) => (i === moves.length - 1 ? events.length : 1))],
      pending: [null, ...moves.map(() => null)],
      moves,
      chat: [],
    };
  };
  const concede = { type: "concede", player: "seatA" };
  const third = (await host.post("/api/rooms", { deck: deckFor("H"), format: "East Blue", type: "BO1" })).json.room;
  await guest.post(`/api/rooms/${third.code}/join`, { deck: deckFor("G") });
  await host.post(`/api/rooms/${third.code}/moves`, { seq: 0, intent: concede });
  await guest.post(`/api/rooms/${third.code}/chat`, { text: "gg", at: 3 });
  const before = (await recordsOf(host)).length;
  r = await host.post(`/api/rooms/${third.code}/result`, { winner: "seatB", record: recordOf([concede, concede]) });
  check("a record of another game does not stop the result", r.status === 200 && r.json.recorded === false);
  r = await guest.post(`/api/rooms/${third.code}/result`, { winner: "seatB", record: recordOf([{ type: "endTurn", player: "seatB" }], { names: ["Mallory", "Mallory"] }) });
  const replayId = r.json.replayId;
  check("both agree, one good record → the game has a replay", r.json.recorded === true && /^[a-z2-9]{10}$/.test(replayId));
  const hostRow = (await recordsOf(host))[0];
  check("each player's record row links to it", (await recordsOf(host)).length === before + 1 && hostRow.replayId === replayId && (await recordsOf(guest))[0].replayId === replayId);
  check("the room says where the replay is", (await host.get(`/api/rooms/${third.code}`)).json.room.replayId === replayId);
  r = await u1.get(`/api/replays/${replayId}`);
  const kept = r.json?.replay;
  check("anyone signed in opens it by its link", r.status === 200 && kept.source === "friend" && kept.format === "East Blue" && kept.winner === "seatB" && kept.firstPlayer === third.firstPlayer && kept.turns === 2 && kept.plays === 1);
  check("someone who was not in the game has no seat in it", kept.viewerSeat === null);
  check("a player is told which seat was theirs", (await guest.get(`/api/replays/${replayId}`)).json.replay.viewerSeat === "seatB");
  check("names, moves and chat are the room's, not the browser's", kept.seats[0].name === "room_host" && kept.record.seats[1].name === "room_guest" && kept.record.moves[0].type === "concede" && kept.record.chat[0]?.text === "gg");
  r = await client().get(`/api/replays/${replayId}`);
  check("the link works with no account", r.status === 200 && r.json.replay.id === replayId && r.json.replay.record.moves.length === 1 && r.json.replay.viewerSeat === null);
  const accountIds = [(await host.get("/api/auth/me")).json.user.id, (await guest.get("/api/auth/me")).json.user.id];
  check("and gives away no account id", accountIds.every((id) => !!id && !JSON.stringify(r.json).includes(id)));
  r = await client().get("/api/replays/nosuchgame");
  check("an unknown replay → 404", r.status === 404);
  r = await client().get("/api/replays/1");
  check("ids are not a counter: a number finds nothing", r.status === 404);
  r = await client().get("/api/me/replays");
  check("the list of one's replays still needs an account", r.status === 401);
  r = await guest.get("/api/me/replays");
  check("it is in both players' lists", r.json.replays.some((x) => x.id === replayId) && (await host.get("/api/me/replays")).json.replays.some((x) => x.id === replayId));
  check("and in nobody else's", !(await u1.get("/api/me/replays")).json.replays.some((x) => x.id === replayId));

  r = await u1.post("/api/replays", { record: recordOf([concede], { names: ["tester_one", "Pro bot"], ai: true }) });
  const aiReplay = r.json?.id;
  check("a game against the AI is sent in by the browser", r.status === 201 && !!aiReplay);
  r = await u1.get("/api/me/replays");
  const mine = r.json.replays.find((x) => x.id === aiReplay);
  check("it is listed as theirs: their seat, not the AI's", mine?.source === "ai" && mine.viewerSeat === "seatA");
  const sentIn = (await client().get(`/api/replays/${aiReplay}`)).json.replay;
  check("its names are the server's: the sender's account and a bot", sentIn.seats[0].name === "tester_one" && sentIn.record.seats[1].name === "Bot");
  const forged = { ...recordOf([concede], { names: ["room_host", "room_guest"] }), chat: [{ seat: "seatA", text: "I cheat", at: 1 }] };
  r = await u1.post("/api/replays", { record: forged });
  const forgedReplay = (await client().get(`/api/replays/${r.json?.id}`)).json?.replay;
  check("a record sent in cannot carry other players' names or a chat",
    r.status === 201 && forgedReplay.source === "local" && forgedReplay.seats.map((s) => s.name).join("|") === "tester_one|tester_one's guest"
      && forgedReplay.record.chat.length === 0 && !JSON.stringify(forgedReplay).includes("room_host"));
  r = await u1.post("/api/replays", { record: recordOf([concede], { names: ["tester_one", "Bot Pro 2"], ai: true }) });
  check("a bot keeps its own name", (await client().get(`/api/replays/${r.json?.id}`)).json.replay.seats[1].name === "Bot Pro 2");

  const mismatch = (await host.post("/api/rooms", { deck: deckFor("H"), format: "East Blue", type: "BO1" })).json.room;
  await guest.post(`/api/rooms/${mismatch.code}/join`, { deck: deckFor("G") });
  await host.post(`/api/rooms/${mismatch.code}/moves`, { seq: 0, intent: concede });
  await host.post(`/api/rooms/${mismatch.code}/result`, { winner: "seatA", record: recordOf([concede]) }); // the record ends with seat B winning
  r = await guest.post(`/api/rooms/${mismatch.code}/result`, { winner: "seatA" });
  check("a record that ends another way than both players said: the result counts, no replay", r.json.recorded === true && r.json.replayId === null);

  r = await u1.post("/api/replays", { record: recordOf([concede], { over: false }) });
  check("a game that is not over → 400", r.status === 400);
  r = await u1.post("/api/replays", { record: { ...recordOf([concede]), cuts: [1, 2] } });
  check("a log that does not match its plays → 400", r.status === 400);
  r = await client().post("/api/replays", { record: recordOf([concede]) });
  check("sending one in needs an account", r.status === 401);

  // a take-back is not in the replay: the room forgets the moves taken back,
  // and keeps only a record that has exactly the moves that stood
  const fourth = (await host.post("/api/rooms", { deck: deckFor("H"), format: "East Blue", type: "BO1" })).json.room;
  await guest.post(`/api/rooms/${fourth.code}/join`, { deck: deckFor("G") });
  const endA = { type: "endTurn", player: "seatA" };
  const endB = { type: "endTurn", player: "seatB" };
  const regretted = { type: "attachDon", player: "seatA" };
  await host.post(`/api/rooms/${fourth.code}/moves`, { seq: 0, intent: endA });
  await guest.post(`/api/rooms/${fourth.code}/moves`, { seq: 1, intent: endB });
  await host.post(`/api/rooms/${fourth.code}/moves`, { seq: 2, intent: regretted });
  await host.post(`/api/rooms/${fourth.code}/undo`, { action: "request" });
  r = await guest.post(`/api/rooms/${fourth.code}/undo`, { action: "accept" });
  check("a take-back is accepted", r.status === 200 && (await host.get(`/api/rooms/${fourth.code}`)).json.room.total === 2);
  await host.post(`/api/rooms/${fourth.code}/moves`, { seq: 2, intent: concede });
  r = await host.post(`/api/rooms/${fourth.code}/result`, { winner: "seatB", record: recordOf([endA, endB, regretted, concede]) });
  check("a record that still has the move taken back is not kept", r.status === 200 && r.json.replayId === null);
  r = await guest.post(`/api/rooms/${fourth.code}/result`, { winner: "seatB", record: recordOf([endA, endB, concede]) });
  const afterTakeBack = r.json.replayId ? (await client().get(`/api/replays/${r.json.replayId}`)).json.replay : null;
  check("the replay has the moves that stood, not the one taken back",
    afterTakeBack?.plays === 3 && afterTakeBack.record.moves.map((m) => m.type).join() === "endTurn,endTurn,concede");

  r = await client().get("/api/stats");
  check("public stats reachable without auth", r.status === 200 && typeof r.json?.captains === "number");
  check("and say whether the pool is open", r.json.rankedOpen === true);

  // ============================ RANKED TABLE ============================
  section("ranked table");
  // two people: the server sets the table, plays every move through the rules engine and writes the result
  // (accounts made earlier: the signup route allows ten new ones per ten minutes)
  const ta = u1, tb = u2;
  const uta = (await ta.get("/api/auth/me")).json.user;
  const rowsBefore = [(await ta.get("/api/me/matches")).json.matches.length, (await tb.get("/api/me/matches")).json.matches.length];
  const redCards = ["004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015"].map((n) => ({ id: `OP01-${n}`, count: 4 }));
  const legalList = [...redCards, { id: "OP01-016", count: 2 }]; // 50 red cards under a red Leader
  const legalDeck = async (c, name) => (await c.post("/api/me/decks", { name, leaderId: "OP01-001", cards: legalList, format: "Standard · OP17" })).json.deck.id;
  const dta = await legalDeck(ta, "Table deck A"), dtb = await legalDeck(tb, "Table deck B");
  r = await ta.post("/api/me/queue/join", { deckId: await deckOf(ta, "OP01-001") });
  check("a deck the rules refuse cannot join the pool", r.status === 400 && /50 cards/.test(r.json?.error ?? ""), JSON.stringify(r.json));
  // `a` joins the pool first: the host of the match, seat A at the table
  const pairUp = async (a, b, deckA, deckB) => {
    await a.post("/api/me/queue/join", { deckId: deckA });
    await b.post("/api/me/queue/join", { deckId: deckB });
    await a.post("/api/queue/tick");
    const status = (await a.get("/api/me/queue/status")).json;
    const first = (await a.post("/api/me/queue/ready", { sessionId: status.sessionId })).json;
    const second = (await b.post("/api/me/queue/ready", { sessionId: status.sessionId })).json;
    return { status, first, second, sessionId: status.sessionId, code: second.roomCode };
  };
  const t1 = await pairUp(ta, tb, dta, dtb);
  check("matched: no table until both confirmed", t1.status.status === "matched" && t1.status.roomCode === null && t1.first.roomCode === null);
  check("both confirmed → the server sets the table", /^[A-Z2-9]{6}$/.test(t1.code ?? ""), JSON.stringify(t1.second));
  check("the queue names the table to each player", (await ta.get("/api/me/queue/status")).json.roomCode === t1.code);
  const tableOf = async (c, code) => (await c.get(`/api/rooms/${code}`)).json.room;
  const table = await tableOf(ta, t1.code);
  check("seats, decks and first player are the server's", table.ranked === true && table.status === "playing" && table.mySeat === "seatA"
    && (await tableOf(tb, t1.code)).mySeat === "seatB" && table.seats[0].name === "tester_one" && table.seats[1].deck.main.length === 50
    && ["seatA", "seatB"].includes(table.firstPlayer));
  r = await host.get(`/api/rooms/${t1.code}`);
  check("nobody else sits at it", r.status === 403);
  const move = (c, code, seq, intent) => c.post(`/api/rooms/${code}/moves`, { seq, intent });
  r = await move(ta, t1.code, 0, { type: "endTurn", player: "seatA" }); // the opening hands are still being kept or redrawn
  check("an illegal move is refused and leaves no trace", r.status === 400 && /^Illegal move/.test(r.json?.error ?? "") && (await tableOf(ta, t1.code)).total === 0, JSON.stringify(r.json));
  r = await move(ta, t1.code, 0, { type: "concede", player: "seatB" });
  check("a move for the other seat → 403", r.status === 403);
  r = await ta.post(`/api/rooms/${t1.code}/undo`, { action: "request" });
  check("no take-backs at a ranked table", r.status === 409);
  r = await ta.post(`/api/match-sessions/${t1.sessionId}/complete`, { winnerId: uta.id });
  check("a player cannot report who won", r.status === 403 && (await ta.get(`/api/match-sessions/${t1.sessionId}`)).json.session.status === "active");
  r = await ta.post(`/api/match-sessions/${t1.sessionId}/cancel`);
  check("nor cancel a game that has started", r.status === 409);
  const firstSeat = table.firstPlayer, firstClient = firstSeat === "seatA" ? ta : tb;
  r = await move(firstClient, t1.code, 0, { type: "respondMulligan", player: firstSeat, take: false });
  check("a legal move is played", r.status === 200 && r.json.total === 1, JSON.stringify(r.json));
  r = await move(tb, t1.code, 1, { type: "concede", player: "seatB" });
  check("conceding ends the game", r.status === 200);
  r = await tb.post(`/api/rooms/${t1.code}/result`, { winner: "seatB" });
  check("a browser's word about the winner changes nothing", r.status === 200 && r.json.recorded === true);
  const ended = (await ta.get(`/api/match-sessions/${t1.sessionId}`)).json.session;
  check("the server wrote the result: the other player won", ended.status === "completed" && ended.winnerId === uta.id, JSON.stringify(ended));
  const rowsA = (await ta.get("/api/me/matches")).json.matches, rowsB = (await tb.get("/api/me/matches")).json.matches;
  const tableReplay = (await tableOf(ta, t1.code)).replayId;
  check("a row each, linked to the replay", rowsA.length === rowsBefore[0] + 1 && rowsB.length === rowsBefore[1] + 1 && rowsA[0].result === "win" && rowsB[0].result === "loss"
    && !!tableReplay && rowsA[0].replayId === tableReplay && rowsB[0].replayId === tableReplay, JSON.stringify([rowsA, rowsB]));
  const rankedReplay = (await client().get(`/api/replays/${tableReplay}`)).json?.replay;
  check("the replay is the server's own record of the game", rankedReplay?.source === "ranked" && rankedReplay.winner === "seatA" && rankedReplay.plays === 2
    && rankedReplay.firstPlayer === firstSeat && rankedReplay.seats[1].name === "tester_two"
    && rankedReplay.record.moves.map((m) => m.type).join() === "respondMulligan,concede"
    && rankedReplay.record.events.at(-1)?.type === "gameEnded");
  await ta.post("/api/me/queue/join", { deckId: dta });
  const ratingOfA = (await ta.get("/api/queue")).json.players.find((p) => p.user_id === uta.id)?.rating;
  await ta.post("/api/me/queue/leave");
  check("the game moved the ladder", ratingOfA > 1500, String(ratingOfA));
  r = await move(ta, t1.code, 2, { type: "concede", player: "seatA" });
  check("no move after the end", r.status === 400);
  check("both players are free again", (await ta.get("/api/me/queue/status")).json.status === "idle" && (await tb.get("/api/me/queue/status")).json.status === "idle");

  // a player who stops asking for the table has left it
  const tc = host, td = guest;
  const utc = (await tc.get("/api/auth/me")).json.user;
  const leftBefore = (await td.get("/api/me/matches")).json.matches.length;
  const t2 = await pairUp(tc, td, await legalDeck(tc, "Table deck C"), await legalDeck(td, "Table deck D"));
  const stopAsking = Date.now() + 2600; // longer than SN_RANKED_GONE_MS; only seat A keeps asking
  while (Date.now() < stopAsking) { await tableOf(tc, t2.code); await new Promise((res) => setTimeout(res, 150)); }
  await tc.post("/api/queue/tick");
  const left = (await tc.get(`/api/match-sessions/${t2.sessionId}`)).json.session;
  const leftRows = (await td.get("/api/me/matches")).json.matches;
  check("a player who left the table loses", left?.status === "completed" && left.winnerId === utc.id && leftRows.length === leftBefore + 1 && leftRows[0].result === "loss", JSON.stringify(left));

  // ============================ THE ACCOUNT ITSELF ============================
  section("account");
  const mails = () => (existsSync(OUTBOX) ? readFileSync(OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const tokenIn = (mail, param) => new RegExp(`http://site\\.test/\\?${param}=([0-9a-f]{64})`).exec(mail?.text ?? "")?.[1];
  const meOf = async (c) => (await c.get("/api/auth/me")).json.user;

  const verifyMail = mails().find((m) => m.to === "u2@test.local" && /confirm/.test(m.subject));
  const verifyToken = tokenIn(verifyMail, "verify");
  check("signing up sends a link to confirm the address", !!verifyToken);
  check("the address is not confirmed before the link is opened", (await meOf(u2)).emailVerified === false);
  r = await client().post("/api/auth/verify", { token: verifyToken });
  check("the link confirms it", r.status === 200 && (await meOf(u2)).emailVerified === true);
  r = await client().post("/api/auth/verify", { token: verifyToken });
  check("a link works once", r.status === 400);

  const sentBefore = mails().length;
  r = await client().post("/api/auth/forgot", { identifier: "nobody@test.local" });
  check("forgot password: an unknown account gets the same answer, and no mail", r.status === 200 && r.json.ok === true && mails().length === sentBefore);
  r = await client().post("/api/auth/forgot", { identifier: "tester_two" });
  const resetToken = tokenIn(mails().at(-1), "reset");
  check("forgot password: a link goes to the account's address", r.status === 200 && mails().at(-1).to === "u2@test.local" && !!resetToken);
  r = await client().post("/api/auth/reset", { token: resetToken, password: "short" });
  check("a new password too short → 400, and the link is still good", r.status === 400);
  r = await client().post("/api/auth/reset", { token: resetToken, password: "newpassword456" });
  check("the link sets a new password", r.status === 200);
  check("every session of the account is over", (await meOf(u2)) === null);
  r = await client().post("/api/auth/reset", { token: resetToken, password: "another-one-789" });
  check("the link works once", r.status === 400);
  r = await client().post("/api/auth/login", { identifier: "tester_two", password: "password123" });
  check("the old password no longer opens the account", r.status === 401);
  r = await u2.post("/api/auth/login", { identifier: "tester_two", password: "newpassword456" });
  check("the new one does", r.status === 200);

  const u2Id = (await meOf(u2)).id;
  r = await u1.post(`/api/admin/users/${u2Id}/reset-link`);
  check("only an admin makes a reset link by hand", r.status === 403);
  r = await admin.post(`/api/admin/users/${u2Id}/reset-link`);
  check("an admin gets a link to pass on", r.status === 200 && /^\/\?reset=[0-9a-f]{64}$/.test(r.json.path ?? ""));

  r = await u2.post("/api/me/password", { current: "wrong-password", next: "anotherpass789" });
  check("changing the password needs the current one", r.status === 403);
  r = await u2.post("/api/me/password", { current: "newpassword456", next: "anotherpass789" });
  check("a new password while signed in: this device stays in", r.status === 200 && (await meOf(u2))?.username === "tester_two");

  r = await client().get("/api/site");
  check("the site says who runs it and what it can do, to anyone", r.status === 200 && r.json.mail === true && typeof r.json.operator === "string");

  // ============================ MODERATION ============================
  section("moderation");
  await u2.post("/api/chat", { body: "a line from tester two" });
  const chatOf = async (c) => (await c.get("/api/chat")).json.messages;
  const twoLine = (await chatOf(u1)).find((m) => m.username === "tester_two" && m.body === "a line from tester two");
  check("a chat line can be found by its id", !!twoLine?.id);

  r = await u1.post("/api/me/blocks/tester_two");
  check("a player blocks another", r.status === 200 && (await u1.get("/api/me/blocks")).json.blocks.some((b) => b.username === "tester_two"));
  r = await u2.post("/api/threads/tester_one", { body: "hello?" });
  check("the blocked player's DM is refused, with no word of the block", r.status === 403 && !/block/i.test(r.json.error));
  r = await u1.post("/api/threads/tester_two", { body: "hi" });
  check("the blocker cannot write either, and is told why", r.status === 403 && /blocked/.test(r.json.error));
  r = await u2.post("/api/me/friends/tester_one");
  check("nor a friend request", r.status === 403);
  check("their friendship is over", !(await u1.get("/api/me/friends")).json.friends.some((f) => f.user?.username === "tester_two"));
  check("their chat lines leave the blocker's chat, not everyone's", !(await chatOf(u1)).some((m) => m.username === "tester_two") && (await chatOf(host)).some((m) => m.username === "tester_two"));
  r = await u1.post("/api/me/blocks/tester_one");
  check("nobody blocks themselves", r.status === 400);

  r = await u1.post("/api/reports", { username: "tester_two", kind: "chat", reason: "spam in the chat", messageId: twoLine.id });
  check("a player reports a chat line", r.status === 201);
  r = await u1.post("/api/reports", { username: "tester_two", kind: "dm", reason: "words never said", messageId: "no-such-message" });
  check("a report about a message that does not exist → 404", r.status === 404);
  r = await u1.get("/api/admin/reports");
  check("reports are for admins", r.status === 403);
  r = await admin.get("/api/admin/reports");
  const report = r.json.reports?.[0];
  check("the admins read it with the words it is about", r.json.open === 1 && report?.excerpt === "a line from tester two" && report.reporter?.username === "tester_one" && report.target.username === "tester_two" && report.reason === "spam in the chat");
  r = await admin.patch(`/api/admin/reports/${report.id}`, { status: "closed" });
  check("and close it", r.status === 200 && (await admin.get("/api/admin/reports")).json.open === 0 && (await admin.get("/api/admin/reports?status=closed")).json.reports.length === 1);

  r = await host.del(`/api/chat/${twoLine.id}`);
  check("nobody deletes someone else's chat line", r.status === 403);
  r = await u2.del(`/api/chat/${twoLine.id}`);
  check("its writer does", r.status === 200 && !(await chatOf(host)).some((m) => m.id === twoLine.id));
  await u2.post("/api/chat", { body: "another line" });
  const another = (await chatOf(host)).find((m) => m.body === "another line");
  r = await admin.del(`/api/chat/${another.id}`);
  check("an admin deletes any line", r.status === 200 && !(await chatOf(host)).some((m) => m.id === another.id));

  await u1.del("/api/me/blocks/tester_two");
  r = await u1.post("/api/threads/tester_two", { body: "sent by mistake" });
  check("unblocked: messages go through again", r.status === 201);
  const mistake = r.json.message.id;
  r = await u2.del(`/api/messages/${mistake}`);
  check("a private message is deleted only by who wrote it", r.status === 403);
  r = await u1.del(`/api/messages/${mistake}`);
  check("and then it is gone for both", r.status === 200 && !(await u2.get("/api/threads/tester_one")).json.messages.some((m) => m.id === mistake));

  // ============================ THE WAY OUT ============================
  section("deleting an account");
  await guest.post("/api/chat", { body: "the guest was here" });
  r = await guest.del("/api/me/account", { password: "not-the-password" });
  check("deleting an account needs its password", r.status === 403 && (await meOf(guest))?.username === "room_guest");
  r = await guest.del("/api/me/account", { password: "password123" });
  check("the account is deleted", r.status === 200 && (await meOf(guest)) === null);
  r = await client().post("/api/auth/login", { identifier: "room_guest", password: "password123" });
  check("it cannot be opened again", r.status === 401);
  check("its profile and its chat lines are gone", (await host.get("/api/profiles/room_guest")).status === 404 && !(await chatOf(host)).some((m) => m.body === "the guest was here"));
  const afterLeaving = (await client().get(`/api/replays/${replayId}`)).json.replay;
  check("the other player keeps the replay, without the deleted account's name or words",
    afterLeaving?.seats[1].name === "Deleted captain" && afterLeaving.record.seats[1].name === "Deleted captain" && afterLeaving.record.chat.length === 0
      && afterLeaving.seats[0].name === "room_host" && !JSON.stringify(afterLeaving.seats).includes("room_guest"));
  check("and their own record of the game", (await recordsOf(host)).some((m) => m.replayId === replayId));
  r = await admin.del("/api/me/account", { password: "admin12345" });
  check("the last admin cannot delete their account", r.status === 400);

  section("Weight");
  const catalog = await fetch(`${BASE}/api/cards`, { headers: { "accept-encoding": "identity" } });
  const tag = catalog.headers.get("etag");
  check("the card catalog carries a tag", catalog.status === 200 && !!tag);
  const catalogAgain = await fetch(`${BASE}/api/cards`, { headers: { "if-none-match": tag ?? "" } });
  check("a browser that already has it gets a 304 and no body", catalogAgain.status === 304 && (await catalogAgain.text()) === "");

  section("Security");
  for (const [method, path] of [["get", "/api/queue"], ["get", "/api/match-sessions/active"], ["get", "/api/match-sessions/nosuch"], ["post", "/api/queue/tick"]]) {
    r = await client()[method](path);
    check(`${method.toUpperCase()} ${path} needs an account`, r.status === 401);
  }
  const health = await fetch(`${BASE}/api/health`);
  check("an answer carries the security headers",
    !!health.headers.get("content-security-policy")?.includes("default-src 'self'") && health.headers.get("x-frame-options") === "DENY");
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await u1.post("/api/queue/tick")).status);
  check("a route's own limit: the matchmaking pass can be forced 30 times a minute, not 31", statuses[0] === 200 && statuses.includes(429));
} finally {
  // wait for the server to be gone before deleting its database
  await new Promise((r) => { server.once("exit", r); server.kill(); });
  cleanupDb();
}

console.log(`\n${"=".repeat(40)}\nRESULT: ${passed} passed, ${failed} failed`);
if (failed) console.log("Failed: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
