// replays.mjs — finished games kept to be watched again (src/features/replay).
//
// A record is what happened on the table: the state after the opening hands,
// every event after it, and where each play ends. The server does not run the
// engine, so it stores the record as the browser sent it, after checking that
// its parts line up.
//
// What a replay may claim. The server cannot tell whether a record was really
// played, and its link is public, so a record never speaks for someone else:
// - a ranked game: the whole record is the server's (it played the game);
// - a friend game: names, moves, chat and who went first are the room's own,
//   and the record must end with the winner both players reported;
// - a game a browser sends in (against the AI, or two players at one screen):
//   the person's seat carries the sender's account name, an AI seat carries a
//   bot's name, and no chat is kept. It can only say "this account played this".
//
// Watching needs no account: whoever has the link watches, as on Duelingbook.
// So GET /api/replays/:id is the one route here that asks for no session. It
// only reads, it answers with that one replay, and the id is the protection:
// 10 random letters (about 49 bits), never a counter, with a limit on how fast
// one address can try ids. No account id is ever in an answer. Sending a replay
// in, and the list of one's own, still need the session.

import { randomInt } from "node:crypto";
import { z } from "zod";
import { all, get, run } from "./db.mjs";

const SEATS = ["seatA", "seatB"];
const MAX_RECORD_BYTES = 2_000_000;
/** The request itself is a little bigger than the record inside it. */
export const RECORD_BODY_LIMIT = MAX_RECORD_BYTES + 200_000;
const MAX_EVENTS = 60_000;
const MAX_PLAYS = 20_000;
/** Games against the AI or at one screen that a player keeps: the oldest go first. */
const MAX_OWN_REPLAYS = 200;
const ID_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o or 1/i/l
const ID_LENGTH = 10;
const ID_SHAPE = new RegExp(`^[${ID_LETTERS}]{${ID_LENGTH}}$`);

const seatSchema = z.object({
  pid: z.enum(SEATS),
  name: z.string().min(1).max(80),
  controller: z.enum(["human", "ai"]),
  deckName: z.string().max(80),
  leaderId: z.string().min(1).max(20),
});
const recordSchema = z.object({
  v: z.literal(1),
  seats: z.tuple([seatSchema, seatSchema]),
  initial: z.object({ players: z.object({}).passthrough(), order: z.array(z.enum(SEATS)).length(2) }).passthrough(),
  events: z.array(z.object({ type: z.string().min(1).max(40) }).passthrough()).max(MAX_EVENTS),
  cuts: z.array(z.number().int().min(0)).min(1).max(MAX_PLAYS + 1),
  pending: z.array(z.object({ kind: z.string() }).passthrough().nullable()).max(MAX_PLAYS + 1),
  moves: z.array(z.object({ type: z.string(), player: z.enum(SEATS) }).passthrough()).max(MAX_PLAYS),
  chat: z.array(z.object({ seat: z.enum(SEATS), text: z.string().max(200), at: z.number().int().min(0) })).max(500),
});

/** The same checks as recordProblem in src/features/replay/record.ts. */
function linesUp(r) {
  if (r.seats[0].pid === r.seats[1].pid) return false;
  if (r.pending.length !== r.cuts.length || r.moves.length !== r.cuts.length - 1) return false;
  for (let i = 1; i < r.cuts.length; i++) if (r.cuts[i] < r.cuts[i - 1]) return false;
  return r.cuts[r.cuts.length - 1] === r.events.length;
}

/** A record a browser sent, checked; null when it cannot be played back. */
export function parseRecord(body) {
  const parsed = recordSchema.safeParse(body);
  return parsed.success && linesUp(parsed.data) ? parsed.data : null;
}

/** The seat the record says won, or null. */
export function recordWinner(record) {
  const ended = record.events.findLast((e) => e.type === "gameEnded");
  return SEATS.includes(ended?.winner) ? ended.winner : null;
}

/** A name an AI seat may carry: "Bot", "Bot Pro", "Bot Pro 2". */
const BOT_NAME = /^Bot( [A-Za-z0-9]{1,12}){0,2}$/;

/** A record a browser sent in, with the names the server answers for (see the top of this file). */
export function sentInRecord(record, user) {
  const sender = user.display_name || user.username;
  let people = 0;
  const seats = record.seats.map((s) => {
    if (s.controller === "ai") return { ...s, name: BOT_NAME.test(s.name) ? s.name : "Bot" };
    people += 1;
    return { ...s, name: people === 1 ? sender : `${sender}'s guest` };
  });
  return { ...record, seats, chat: [] };
}

function newId() {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) id += ID_LETTERS[randomInt(ID_LETTERS.length)];
  return id;
}

/** Stores a record; `users` = the accounts in seat A and seat B (null: the AI, or nobody's own seat).
 *  `firstPlayer`: who went first, when the server knows it itself (a room).
 *  Returns the replay's id, or null when the record is too big to keep. */
export async function saveReplay({ source, format = "", savedBy = null, users = [null, null], firstPlayer = null, record }) {
  const json = JSON.stringify(record);
  if (json.length > MAX_RECORD_BYTES) return null;
  const winner = recordWinner(record);
  const turns = record.events.reduce((max, e) => (e.type === "turnStarted" && Number.isInteger(e.turn) ? Math.max(max, e.turn) : max), 0);
  const seat = (pid) => record.seats.find((s) => s.pid === pid);
  const id = newId();
  await run(
    `INSERT INTO replays (id, created_at, source, format, saved_by, user_a, user_b, name_a, name_b, leader_a, leader_b, winner, first_player, turns, plays, record)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, Date.now(), source, format, savedBy, users[0], users[1], seat("seatA").name, seat("seatB").name, seat("seatA").leaderId, seat("seatB").leaderId,
      winner, firstPlayer ?? record.initial.order[0], turns, record.moves.length, json],
  );
  return id;
}

/** What a list or a viewer is told about a replay. `viewerId`: the account asking, if any —
 *  it only says which seat was theirs, so that no account id leaves the server. */
const summary = (r, viewerId = null) => ({
  id: r.id,
  createdAt: r.created_at,
  source: r.source,
  format: r.format,
  seats: [
    { pid: "seatA", name: r.name_a, leaderId: r.leader_a },
    { pid: "seatB", name: r.name_b, leaderId: r.leader_b },
  ],
  /** The seat the asker played, when exactly one was theirs. */
  viewerSeat: !viewerId || (r.user_a === viewerId) === (r.user_b === viewerId) ? null : r.user_a === viewerId ? "seatA" : "seatB",
  winner: r.winner,
  firstPlayer: r.first_player,
  turns: r.turns,
  plays: r.plays,
});
const SUMMARY_COLUMNS = "id, created_at, source, format, user_a, user_b, name_a, name_b, leader_a, leader_b, winner, first_player, turns, plays";

/** `currentUser(req)`: the session's account, or null — for the one route that works without one. */
export function registerReplays(app, requireUser, currentUser) {
  // a game against the AI or at one screen: the browser that played it sends it in
  app.post("/api/replays", { bodyLimit: RECORD_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const sent = parseRecord(req.body?.record);
    if (!sent) return reply.code(400).send({ error: "Invalid replay" });
    if (!sent.events.some((e) => e.type === "gameEnded")) return reply.code(400).send({ error: "The game is not over" });
    const record = sentInRecord(sent, user);
    const ai = record.seats.some((s) => s.controller === "ai");
    // against the AI the person's seat is theirs; at one screen both seats are whoever sat there
    const users = record.seats.map((s) => (ai && s.controller === "human" ? user.id : null));
    const bySeat = SEATS.map((pid) => users[record.seats.findIndex((s) => s.pid === pid)]);
    const id = await saveReplay({ source: ai ? "ai" : "local", savedBy: user.id, users: bySeat, record });
    if (!id) return reply.code(413).send({ error: "This game is too long to keep" });
    await run(
      `DELETE FROM replays WHERE saved_by = ? AND id NOT IN (SELECT id FROM replays WHERE saved_by = ? ORDER BY created_at DESC LIMIT ?)`,
      [user.id, user.id, MAX_OWN_REPLAYS],
    );
    return reply.code(201).send({ id });
  });

  // the games this player was in, or sent in: newest first
  app.get("/api/me/replays", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 60));
    const rows = await all(
      `SELECT ${SUMMARY_COLUMNS} FROM replays WHERE saved_by = ? OR user_a = ? OR user_b = ? ORDER BY created_at DESC LIMIT ?`,
      [user.id, user.id, user.id, limit],
    );
    return reply.send({ replays: rows.map((r) => summary(r, user.id)) });
  });

  // public: the link is the key (see the top of this file)
  app.get("/api/replays/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const id = String(req.params.id).toLowerCase();
    const row = ID_SHAPE.test(id) ? await get(`SELECT * FROM replays WHERE id = ?`, [id]) : null;
    if (!row) return reply.code(404).send({ error: "This replay does not exist" });
    const viewer = await currentUser(req);
    return reply.send({ replay: { ...summary(row, viewer?.id ?? null), record: JSON.parse(row.record) } });
  });
}
