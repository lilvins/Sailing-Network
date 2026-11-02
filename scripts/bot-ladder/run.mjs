// run.mjs — the bot ladder: every account marked is_bot plays ranked through the
// real HTTP API (queue, ready, complete), and each game is really played by the
// Pro agent on AUTOSIM. Nothing is written to `matches` from here: results reach
// the ladder the same way a person's would. See README.md.
//
//   npm run bots:run                       (API on http://127.0.0.1:8787)
//   SN_API=http://127.0.0.1:8788 npm run bots:run
//   npm run bots:run -- --games 20         (stop after 20 games, for a check)

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { constants as osConstants, setPriority } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { buildSync } from "esbuild";
import db, { all, initDb, run } from "../../server/db.mjs";
import { createSession } from "../../server/auth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", ".bot-ladder");
const API = process.env.SN_API || "http://127.0.0.1:8787";
const CFG = JSON.parse(readFileSync(join(HERE, "tuning.json"), "utf8"));
const args = process.argv.slice(2);
const stopAfter = args.includes("--games") ? Number(args[args.indexOf("--games") + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);
const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

mkdirSync(OUT, { recursive: true });
const GAMES_LOG = join(OUT, "games.jsonl");
const WORKER_FILE = join(OUT, "game-worker.mjs");
buildSync({
  entryPoints: [join(HERE, "game-worker.ts")], outfile: WORKER_FILE, bundle: true,
  platform: "node", format: "esm", target: "node22", loader: { ".json": "json" }, logLevel: "error",
});

// the PC stays usable while the bots think
try { setPriority(process.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* keep default */ }

// ---------- game pool ----------
let nextJob = 1;
const waiting = [];
const running = new Map();
const idle = [];

function spawnWorker() {
  const w = new Worker(WORKER_FILE);
  w.on("message", (res) => finish(w, res));
  w.on("error", (err) => finish(w, { id: w.jobId, winner: null, error: String(err) }, true));
  idle.push(w);
}
function finish(w, res, dead = false) {
  const job = running.get(res.id);
  if (!job) return;
  running.delete(res.id);
  clearTimeout(job.timer);
  job.resolve(res);
  if (dead) spawnWorker(); else idle.push(w);
  pump();
}
function pump() {
  while (idle.length && waiting.length) {
    const w = idle.pop();
    const job = waiting.shift();
    w.jobId = job.msg.id;
    running.set(job.msg.id, job);
    job.timer = setTimeout(() => {
      w.terminate();
      finish(w, { id: job.msg.id, winner: null, error: "timeout" }, true);
    }, CFG.gameTimeoutSec * 1000);
    w.postMessage(job.msg);
  }
}
const playGame = (msg) => new Promise((resolve) => {
  waiting.push({ msg: { ...msg, id: nextJob++, maxSteps: CFG.maxStepsPerGame }, resolve });
  pump();
});

// ---------- accounts ----------
await initDb();
const rows = await all(`SELECT id, username FROM users WHERE is_bot=1`);
if (!rows.length) {
  console.error("No bot accounts. Run: npm run bots:seed");
  process.exit(1);
}
// sessions are made here, not through /login: the accounts have no usable password
await run(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_bot=1)`);

function skillOf(username) {
  const x = createHash("sha256").update(username).digest().readUInt32BE(0) / 2 ** 32;
  let acc = 0;
  for (const s of CFG.skills) { acc += s.share; if (x < acc) return s; }
  return CFG.skills[CFG.skills.length - 1];
}
const bots = await Promise.all(rows.map(async (r) => ({
  id: r.id, username: r.username, cookie: `sn_session=${await createSession(r.id)}`, skill: skillOf(r.username),
  presence: "offline", decks: [],
})));
// from here on everything goes through the API: this process must not hold the DB
db.close();
const botNames = new Set(bots.map((b) => b.username));

// ---------- HTTP ----------
const totals = { games: 0, cancelled: 0, fellBack: 0, httpErrors: 0, started: Date.now() };

async function api(bot, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: { cookie: bot.cookie, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status < 500) {
        const json = await res.json().catch(() => null);
        if (res.status >= 400) {
          totals.httpErrors++;
          log(`HTTP ${res.status} ${method} ${path}: ${json?.error ?? ""}`);
        }
        return { status: res.status, json };
      }
      totals.httpErrors++;
      log(`HTTP ${res.status} ${method} ${path} (retry)`);
    } catch (err) {
      totals.httpErrors++;
      log(`${method} ${path}: ${err.cause?.code ?? err.message} (retry)`);
    }
    await sleep(Math.min(30_000, 1000 * 2 ** attempt));
  }
}

async function setPresence(bot, status) {
  bot.presence = status;
  await api(bot, "PATCH", "/api/me/presence", { status });
}

// ---------- one ranked game ----------
const reported = new Map(); // session id -> winner the host reported
const deckCache = new Map();
async function loadDeck(bot, deckId) {
  if (!deckCache.has(deckId)) {
    const { json } = await api(bot, "GET", `/api/decks/${deckId}`);
    deckCache.set(deckId, json.deck);
  }
  return deckCache.get(deckId);
}
const pickDeck = (bot) => (Math.random() < CFG.favoriteDeckShare ? bot.decks[0] : bot.decks[Math.floor(Math.random() * bot.decks.length)]);

async function hostGame(bot, s) {
  const opp = bots.find((b) => b.id === s.opponentId);
  const [mine, theirs] = await Promise.all([loadDeck(bot, s.hostDeckId), loadDeck(bot, s.opponentDeckId)]);
  const side = (deck, skill) => ({
    leader: deck.leaderId, cards: deck.cards,
    skill: { candidates: skill.candidates, rollouts: skill.rollouts },
  });
  const res = await playGame({
    seed: s.id, first: s.hostOnPlay ? "p1" : "p2",
    p1: side(mine, bot.skill), p2: side(theirs, opp.skill),
  });
  const winnerId = res.winner === "p1" ? bot.id : res.winner === "p2" ? opp.id : null;
  totals.fellBack += res.fellBack ?? 0;
  appendFileSync(GAMES_LOG, JSON.stringify({
    at: new Date().toISOString(), session: s.id, host: bot.username, opp: opp.username,
    hostLeader: mine.leaderId, oppLeader: theirs.leaderId, hostSkill: bot.skill.name, oppSkill: opp.skill.name,
    winner: res.winner, turn: res.turn, steps: res.steps, fellBack: res.fellBack, ms: res.ms, error: res.error,
  }) + "\n");
  if (winnerId) {
    await api(bot, "POST", `/api/match-sessions/${s.id}/complete`, { winnerId });
    reported.set(s.id, winnerId); // the opponent bot confirms it in playOne
    totals.games++;
    log(`#${totals.games} ${bot.username} (${mine.leaderName}) vs ${opp.username} (${theirs.leaderName}): ${res.winner === "p1" ? bot.username : opp.username} wins, turn ${res.turn}, ${Math.round(res.ms / 1000)}s`);
  } else {
    await api(bot, "POST", `/api/match-sessions/${s.id}/cancel`, {});
    totals.cancelled++;
    log(`CANCELLED ${s.id} ${mine.leaderId} vs ${theirs.leaderId}: ${res.error ? res.error.split("\n")[0] : `no winner after ${res.steps} steps`}`);
  }
}

async function playOne(bot) {
  const { json: st0 } = await api(bot, "GET", "/api/me/queue/status");
  if (st0?.status !== "matched") await api(bot, "POST", "/api/me/queue/join", { deckId: pickDeck(bot).id });

  const giveUp = Date.now() + CFG.queueGiveUpSec * 1000;
  let sessionId = st0?.status === "matched" ? st0.sessionId : null;
  let oppName = st0?.opponentUsername;
  while (!sessionId) {
    if (Date.now() > giveUp) { await api(bot, "POST", "/api/me/queue/leave", {}); return; }
    await sleep(2000 + Math.random() * 2000);
    const { json: st } = await api(bot, "GET", "/api/me/queue/status");
    if (st?.status === "matched") { sessionId = st.sessionId; oppName = st.opponentUsername; }
    else if (st?.status === "idle") await api(bot, "POST", "/api/me/queue/join", { deckId: pickDeck(bot).id });
  }
  // never sit down against a person: the pending match expires by itself
  if (!botNames.has(oppName)) { await sleep(65_000); return; }

  await api(bot, "POST", "/api/me/queue/ready", { sessionId });
  await setPresence(bot, "in_duel");
  for (;;) {
    const { json } = await api(bot, "GET", `/api/match-sessions/${sessionId}`);
    const s = json?.session;
    if (!s || s.status === "completed" || s.status === "cancelled") break;
    if (s.status === "active" && s.hostUserId === bot.id) { await hostGame(bot, s); break; }
    if (reported.has(sessionId)) {
      await api(bot, "POST", `/api/match-sessions/${sessionId}/complete`, { winnerId: reported.get(sessionId) });
      reported.delete(sessionId);
      break;
    }
    await sleep(2000 + Math.random() * 1000);
  }
  await setPresence(bot, "online");
}

// ---------- a bot's life: sit down, play a few games, leave ----------
let online = 0;
let stopping = false;

async function life(bot) {
  await sleep(Math.random() * 30_000);
  while (!stopping) {
    if (online >= CFG.maxOnline) { await sleep(5000 + Math.random() * 10_000); continue; }
    online++;
    await setPresence(bot, "online");
    const n = Math.round(between(CFG.gamesPerSitting));
    for (let i = 0; i < n && !stopping; i++) {
      await playOne(bot);
      await sleep(between(CFG.restBetweenGamesSec) * 1000);
    }
    await setPresence(bot, "offline");
    online--;
    await sleep(between(CFG.offlineMin) * 60_000);
  }
}

// presence goes stale after 70s without news
const heartbeat = setInterval(() => {
  for (const b of bots) if (b.presence !== "offline") api(b, "PATCH", "/api/me/presence", { status: b.presence });
}, 45_000);

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  await Promise.all(bots.map(async (b) => {
    await api(b, "POST", "/api/me/queue/leave", {});
    await api(b, "PATCH", "/api/me/presence", { status: "offline" });
  }));
  const minutes = (Date.now() - totals.started) / 60_000;
  log(`stopped: ${totals.games} games, ${totals.cancelled} cancelled, ${totals.fellBack} engine fallbacks, ${totals.httpErrors} HTTP errors, ${minutes.toFixed(1)} min`);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------- start ----------
for (const b of bots) {
  const { json } = await api(b, "GET", "/api/me/decks");
  const decks = (json?.decks ?? []).filter((d) => d.leaderId);
  b.decks = [...decks.filter((d) => d.fav), ...decks.filter((d) => !d.fav)];
}
const ready = bots.filter((b) => b.decks.length);
for (let i = 0; i < CFG.workers; i++) spawnWorker();
log(`${ready.length} bots, ${CFG.workers} workers, API ${API}`);
for (const b of ready) life(b).catch((err) => log(`${b.username} stopped: ${err.stack ?? err}`));

setInterval(() => { if (totals.games >= stopAfter) shutdown(); }, 2000);
