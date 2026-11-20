// Friend games (src/features/board-auto/room.ts). Lockstep: the engine is
// deterministic, so a room only keeps the two decks, the seed, who goes first
// and the ordered list of moves. Each browser replays them with AUTOSIM.
// The server does not run the engine: it checks who sends a move and its
// order, not whether it is legal. Rooms live in memory: a restart ends them.
//
// A RANKED table is a room too, but the server made it (seats, decks, seed,
// who goes first: none of it comes from a player) and plays it: each move goes
// through the rules engine (engine.mjs), an illegal one is refused, and when
// the game ends the server writes the result and the replay from its own
// events. No take-back, no rematch, no result reported by a browser. A player
// who stops asking for the table has left it and loses.
// Only the server holds a ranked game. A browser gets no seed, no decklist of
// the other player and no moves: it gets its own player's view of the game
// and the events as that player may read them (src/autosim/view.ts), so the
// other hand, both decks and the face-down Life cards never leave the server.
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { get } from "./db.mjs";
import { cancelMatchSession, completeMatchSession, createMatch, getDeck, getMatchSession, setUserPresence } from "./store.mjs";
import { cardDb, loadEngine, mainOf } from "./engine.mjs";
import { RECORD_BODY_LIMIT, parseRecord, recordWinner, saveReplay } from "./replays.mjs";
import { limit } from "./security.mjs";

const SEATS = ["seatA", "seatB"];
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L
const CODE_LENGTH = 6;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MOVES = 20000;
const MAX_CHAT = 500;
/** A host who stopped polling this long ago has gone: their duel leaves the list. */
const HOST_GONE_MS = 15000;

const deckSchema = z.object({
  name: z.string().min(1).max(80),
  leaderId: z.string().min(1).max(20),
  main: z.array(z.string().min(1).max(20)).min(1).max(60),
  /** The saved deck it came from (none for a ready-made list): its record counts the game. */
  deckId: z.string().min(1).max(60).optional(),
});
const moveSchema = z.object({ seq: z.number().int().min(0), intent: z.object({ type: z.string(), player: z.enum(SEATS) }).passthrough() });
const hostSchema = z.object({
  deck: deckSchema,
  format: z.string().min(1).max(40),
  type: z.string().min(1).max(20),
  note: z.string().trim().max(80).default(""),
  password: z.string().max(60).default(""),
});
const undoSchema = z.object({ action: z.enum(["request", "accept", "decline"]), toLength: z.number().int().min(0).optional() });
const chatSchema = z.object({ text: z.string().trim().min(1).max(200), at: z.number().int().min(0) });
const rematchSchema = z.object({ action: z.enum(["request", "leave"]) });
const resultSchema = z.object({ winner: z.enum(SEATS) });

const rooms = new Map();
/** Ranked tables: match session id → room code; and the ones being set up right now. */
const rankedCodes = new Map();
const openingRanked = new Map();
/** A ranked game that started before this is not in memory any more: a restart lost it. */
const BOOTED_AT = Date.now();

function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

function dropExpired(now) {
  for (const [code, room] of rooms) if (now - room.touchedAt > ROOM_TTL_MS) rooms.delete(code);
}

const seatOf = (room, userId) => room.seats.findIndex((s) => s?.userId === userId);
const publicSeat = (s) => (s ? { name: s.name, deck: s.deck } : null);

/** The other player at a ranked table: who they are and their Leader, not their list. */
const rankedOpponent = (s) => ({ name: s.name, deck: { name: "", leaderId: s.deck.leaderId, main: [] } });

/** The game of a ranked table as the player in `seat` may see it now (src/autosim/view.ts). */
function rankedView(room, seat) {
  const g = room.ranked, mine = g.seats[seat];
  if (g.state && mine.viewAt !== room.moves.length) {
    mine.view = g.engine.viewOf(g.state, SEATS[seat], mine.known);
    mine.viewAt = room.moves.length;
  }
  return mine.view;
}

/** What a ranked table adds for the player in `seat`, who has `after` moves and `eventsAfter` events of it:
 *  the events they lack and, when they lack anything, the game as it stands for them. */
function rankedNews(room, seat, after, eventsAfter) {
  const mine = room.ranked.seats[seat];
  const eventsFrom = Math.min(eventsAfter, mine.events.length);
  const behind = after !== room.moves.length || eventsFrom !== mine.events.length;
  return { view: behind ? rankedView(room, seat) : null, eventsFrom, events: mine.events.slice(eventsFrom) };
}

function toClient(room, seat, after, chatAfter, eventsAfter = 0) {
  return {
    code: room.code,
    mySeat: SEATS[seat],
    status: room.seats[1] ? "playing" : "waiting",
    seed: room.ranked ? "" : room.seed,
    firstPlayer: room.firstPlayer,
    seats: room.ranked ? room.seats.map((s, i) => (i === seat ? publicSeat(s) : rankedOpponent(s))) : room.seats.map(publicSeat),
    total: room.moves.length,
    /** Goes up when moves are taken back: every browser rebuilds the game. */
    epoch: room.epoch,
    undoBy: room.undoBy === null ? null : SEATS[room.undoBy],
    rematchVotes: SEATS.filter((_, i) => room.rematch[i]),
    leftSeats: SEATS.filter((_, i) => room.left[i]),
    nextCode: room.next,
    /** The finished game, to watch again (null: not over, or no record was kept). */
    replayId: room.replayId,
    /** A ranked table: the server plays it (no take-back, no rematch, no result to report). */
    ranked: !!room.ranked,
    moves: room.ranked ? [] : room.moves.slice(after),
    chat: room.chat.slice(chatAfter),
    ...(room.ranked ? rankedNews(room, seat, after, eventsAfter) : {}),
  };
}

const openDuel = (room, userId) => ({
  id: room.code,
  host: room.seats[0].name,
  mine: room.seats[0].userId === userId,
  format: room.format,
  type: room.type,
  note: room.note,
  locked: room.password !== "",
  leaderId: room.seats[0].deck.leaderId,
});

const roomCode = (req) => String(req.params.code).toUpperCase();
const seatName = (user) => user.display_name || user.username;

/** A new room object: moves, votes and results all start empty. */
function newRoom(now, fields) {
  return {
    code: newCode(), touchedAt: now, hostSeenAt: now,
    /** When each seat last asked for the room (a ranked table: who is still there). */
    seenAt: [now, now],
    /** A ranked table: the game as the server plays it (openRankedTable). */
    ranked: null,
    seed: `room-${randomBytes(9).toString("hex")}`,
    firstPlayer: SEATS[randomInt(2)],
    moves: [], chat: [], epoch: 0, undoBy: null,
    rematch: [false, false], left: [false, false], next: null,
    results: [null, null], recorded: false,
    /** The game as a browser recorded it (src/features/replay), kept once both agree on the winner. */
    record: null, replayId: null,
    ...fields,
  };
}

/** The saved deck behind a seat, only if it really is that player's. */
async function ownDeckId(seat) {
  if (!seat.deck.deckId) return null;
  const deck = await getDeck(seat.deck.deckId);
  return deck?.user_id === seat.userId ? deck.id : null;
}

/** The record a browser sent, if it is this room's game: as many plays as the
 *  room has moves. What the server knows itself replaces the browser's word for it. */
function roomRecord(room, body) {
  const record = parseRecord(body);
  if (!record || record.moves.length !== room.moves.length) return null;
  const seats = SEATS.map((pid, i) => ({
    pid, name: room.seats[i].name, controller: "human", deckName: room.seats[i].deck.name, leaderId: room.seats[i].deck.leaderId,
  }));
  return { ...record, seats, moves: room.moves, chat: room.chat };
}

/** Both players said who won and agree: one row each in their records. Marked
 *  "friend", so it stays out of the ladder and the meta (server/stats). */
async function recordFriendGame(room) {
  const winner = room.results[0];
  // a record that ends another way than both players said is not this game: the result counts, with no replay
  if (room.record && recordWinner(room.record) !== winner) room.record = null;
  if (room.record) {
    room.replayId = await saveReplay({
      source: "friend", format: room.format, users: room.seats.map((s) => s.userId), firstPlayer: room.firstPlayer, record: room.record,
    });
    room.record = null; // it is in the database now
  }
  await Promise.all(room.seats.map(async (seat, i) => {
    const other = room.seats[1 - i];
    await createMatch({
      userId: seat.userId, oppUserId: other.userId, myDeckId: await ownDeckId(seat),
      myLeaderId: seat.deck.leaderId, oppLeaderId: other.deck.leaderId,
      result: winner === SEATS[i] ? "win" : "loss", onPlay: room.firstPlayer === SEATS[i],
      format: room.format, source: "friend", replayId: room.replayId,
    });
  }));
}

// ---------------------------------------------------------------- ranked

const accountName = async (userId) => seatName(await get(`SELECT username, display_name FROM users WHERE id=?`, [userId]));

/** Sets up the table of a ranked match: the server deals the game. Throws when a deck is not legal. */
async function openRankedTable(session) {
  const [engine, db, decks, names] = await Promise.all([
    loadEngine(), cardDb(),
    Promise.all([getDeck(session.host_deck_id), getDeck(session.opponent_deck_id)]),
    Promise.all([accountName(session.host_user_id), accountName(session.opponent_id)]),
  ]);
  const userIds = [session.host_user_id, session.opponent_id];
  const seats = decks.map((deck, i) => ({
    userId: userIds[i], name: names[i],
    deck: { name: deck.name, leaderId: deck.leader_id, main: mainOf(deck), deckId: deck.id },
  }));
  const now = Date.now();
  const room = newRoom(now, { format: decks[0].format || "", type: "Ranked", note: "", password: "", seats });
  room.firstPlayer = session.host_on_play ? SEATS[0] : SEATS[1]; // decided when the two were paired
  const made = engine.createGame(db, {
    seed: room.seed, firstPlayer: room.firstPlayer,
    players: seats.map((s, i) => ({ id: SEATS[i], leader: s.deck.leaderId, deck: s.deck.main })),
  });
  room.ranked = {
    sessionId: session.id, engine, db, done: false,
    state: made.state, initial: made.state, events: [...made.events], cuts: [made.events.length], pending: [made.state.pendingChoice],
    /** Per seat: the cards that player has been shown, the events as they may read them, their view when last asked. */
    seats: SEATS.map((pid) => {
      const known = new Set();
      return { known, events: engine.redactSetup(made.state, made.events, pid, known), view: null, viewAt: -1 };
    }),
  };
  rooms.set(room.code, room);
  rankedCodes.set(session.id, room.code);
  return room;
}

/** The room code of a ranked match's table, if it has one. */
export const rankedCodeOf = (sessionId) => {
  const code = rankedCodes.get(sessionId);
  return code && rooms.has(code) ? code : null;
};

/** The table of an active ranked match, set up on the first call. Null: the game was lost in a restart. */
export async function rankedTable(session) {
  const code = rankedCodeOf(session.id);
  if (code) return rooms.get(code);
  if (session.started_at && session.started_at < BOOTED_AT) return null;
  let opening = openingRanked.get(session.id);
  if (!opening) {
    opening = openRankedTable(session).finally(() => openingRanked.delete(session.id));
    openingRanked.set(session.id, opening);
  }
  return opening;
}

/** One move of a ranked game, played by the server. `seat`: the player who sent it, as they name the
 *  cards (a hidden one by its stand-in); none when the move is the server's own. Returns why it was
 *  refused, in words that player may read, or null. */
async function playRanked(room, intent, seat = -1) {
  const g = room.ranked;
  if (g.done) return "The game is over";
  let played;
  try {
    if (seat >= 0) intent = g.engine.resolveIntent(g.state, SEATS[seat], intent);
    played = g.engine.applyIntent(g.db, g.state, intent);
  } catch (err) {
    const why = String(err?.message ?? err);
    return `Illegal move: ${seat >= 0 ? g.engine.redactText(g.state, SEATS[seat], why) : why}`;
  }
  SEATS.forEach((pid, i) => g.seats[i].events.push(...g.engine.redactPlay(g.state, played.events, played.state, pid, g.seats[i].known)));
  g.state = played.state;
  g.events.push(...played.events);
  g.cuts.push(g.events.length);
  g.pending.push(played.state.pendingChoice);
  room.moves.push(intent);
  if (played.state.phase === "over") await finishRanked(room);
  return null;
}

/** The game is over: the server writes the result (the ladder reads it) and the replay, from its own events. */
async function finishRanked(room) {
  const g = room.ranked;
  if (g.done) return;
  g.done = true;
  room.recorded = true;
  const winner = SEATS.indexOf(g.state.winner);
  const session = await getMatchSession(g.sessionId);
  if (session?.status === "active") {
    if (winner < 0) {
      await cancelMatchSession(session.id); // no winner: no result
    } else {
      const seats = SEATS.map((pid, i) => ({
        pid, name: room.seats[i].name, controller: "human", deckName: room.seats[i].deck.name, leaderId: room.seats[i].deck.leaderId,
      }));
      const record = { v: 1, seats, initial: g.initial, events: g.events, cuts: g.cuts, pending: g.pending, moves: room.moves, chat: room.chat };
      room.replayId = await saveReplay({
        source: "ranked", format: room.format, users: room.seats.map((s) => s.userId), firstPlayer: room.firstPlayer, record,
      });
      await completeMatchSession(session.id, room.seats[winner].userId, room.replayId);
    }
  }
  await Promise.all(room.seats.map((s) => setUserPresence(s.userId, "online")));
  // the game itself is in the replay now: the room keeps what each player may still ask for
  const seats = SEATS.map((_, i) => ({ events: g.seats[i].events, view: rankedView(room, i), viewAt: room.moves.length }));
  room.ranked = { sessionId: g.sessionId, done: true, seats };
}

/** A player who has not asked for their ranked table for `goneMs` has left it: they lose.
 *  When both are gone the game has no result. Called with the matchmaking pass. */
export async function sweepRankedTables(goneMs, now = Date.now()) {
  for (const room of [...rooms.values()]) {
    if (!room.ranked || room.ranked.done) continue;
    const gone = room.seenAt.map((t) => now - t > goneMs);
    if (!gone[0] && !gone[1]) continue;
    if (gone[0] && gone[1]) {
      room.ranked.state = { ...room.ranked.state, winner: null };
      await finishRanked(room);
    } else {
      await playRanked(room, { type: "concede", player: SEATS[gone[0] ? 0 : 1] });
    }
  }
}

export function registerRooms(app, requireUser) {
  app.get("/api/rooms", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const now = Date.now();
    const open = [...rooms.values()].filter((r) => !r.seats[1] && now - r.hostSeenAt < HOST_GONE_MS);
    return reply.send({ duels: open.map((r) => openDuel(r, user.id)) });
  });

  app.post("/api/rooms", limit(20, "10 minutes"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = hostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid duel" });
    const now = Date.now();
    dropExpired(now);
    for (const [code, r] of rooms) if (r.seats[0].userId === user.id && !r.seats[1]) rooms.delete(code);
    const room = newRoom(now, {
      format: parsed.data.format, type: parsed.data.type, note: parsed.data.note, password: parsed.data.password,
      seats: [{ userId: user.id, name: seatName(user), deck: parsed.data.deck }, null],
    });
    rooms.set(room.code, room);
    return reply.code(201).send({ room: toClient(room, 0, 0, 0) });
  });

  app.post("/api/rooms/:code/join", limit(20, "1 minute"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This duel no longer exists" });
    const already = seatOf(room, user.id);
    if (already === 0 && !room.seats[1]) return reply.code(400).send({ error: "This is your own duel" });
    if (already >= 0) return reply.send({ room: toClient(room, already, 0, 0) });
    if (room.seats[1]) return reply.code(409).send({ error: "This duel already has two players" });
    if (room.password && req.body?.password !== room.password) return reply.code(403).send({ error: "Wrong duel password" });
    const parsed = deckSchema.safeParse(req.body?.deck);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid deck" });
    room.seats[1] = { userId: user.id, name: seatName(user), deck: parsed.data };
    room.touchedAt = Date.now();
    return reply.send({ room: toClient(room, 1, 0, 0) });
  });

  app.get("/api/rooms/:code", limit(300, "1 minute"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (seat === 0) room.hostSeenAt = Date.now();
    room.seenAt[seat] = Date.now();
    const after = Math.max(0, Number(req.query.after) || 0);
    const chatAfter = Math.max(0, Number(req.query.chatAfter) || 0);
    const eventsAfter = Math.max(0, Number(req.query.eventsAfter) || 0);
    return reply.send({ room: toClient(room, seat, after, chatAfter, eventsAfter) });
  });

  app.post("/api/rooms/:code/moves", limit(300, "1 minute"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (!room.seats[1]) return reply.code(409).send({ error: "The game has not started" });
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid move" });
    if (parsed.data.intent.player !== SEATS[seat]) return reply.code(403).send({ error: "That move is not yours" });
    if (parsed.data.seq !== room.moves.length) return reply.code(409).send({ error: "Out of sync" });
    if (room.moves.length >= MAX_MOVES) return reply.code(409).send({ error: "This game is too long" });
    room.seenAt[seat] = Date.now();
    if (room.ranked) {
      const refused = await playRanked(room, parsed.data.intent, seat);
      if (refused) return reply.code(400).send({ error: refused });
    } else {
      room.moves.push(parsed.data.intent);
    }
    room.undoBy = null;
    room.touchedAt = Date.now();
    if (!room.ranked) return reply.send({ total: room.moves.length });
    // the answer carries what the move led to, for the one who made it: their table shows it without waiting for the next poll
    const eventsAfter = Math.max(0, Number(req.body?.eventsAfter) || 0);
    return reply.send({ total: room.moves.length, room: toClient(room, seat, parsed.data.seq, room.chat.length, eventsAfter) });
  });

  // a take-back: one player asks, the other accepts and says how far back the
  // moves go (src/autosim/engine/takeBack.ts decides, so the whole action goes);
  // without that, the requester's last move and everything after it
  app.post("/api/rooms/:code/undo", limit(60, "1 minute"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (room.ranked) return reply.code(409).send({ error: "A ranked game has no take-backs" });
    const parsed = undoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    const { action } = parsed.data;
    if (action === "request") {
      if (!room.moves.some((m) => m.player === SEATS[seat])) return reply.code(409).send({ error: "You have no move to take back" });
      room.undoBy = seat;
    } else if (action === "decline") {
      room.undoBy = null;
    } else {
      if (room.undoBy === null || room.undoBy === seat) return reply.code(409).send({ error: "Only your opponent can accept" });
      const last = room.moves.findLastIndex((m) => m.player === SEATS[room.undoBy]);
      const { toLength } = parsed.data;
      room.moves.length = toLength !== undefined && toLength <= last ? toLength : last;
      room.undoBy = null;
      room.epoch += 1;
    }
    room.touchedAt = Date.now();
    return reply.send({ ok: true });
  });

  app.post("/api/rooms/:code/chat", limit(40, "1 minute"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid message" });
    if (room.chat.length >= MAX_CHAT) return reply.code(409).send({ error: "The chat is full" });
    room.chat.push({ seat: SEATS[seat], text: parsed.data.text, at: parsed.data.at });
    return reply.send({ ok: true });
  });

  // "Rematch": when both players asked, a new room with the same seats and decks
  // (new seed, new first player); both browsers follow `nextCode` there.
  // "leave": the other player is told, and no rematch can happen any more.
  app.post("/api/rooms/:code/rematch", limit(30, "1 minute"), async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (!room.seats[1]) return reply.code(409).send({ error: "The game has not started" });
    const parsed = rematchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request" });
    if (parsed.data.action === "leave") {
      if (!room.next) { room.left[seat] = true; room.rematch[seat] = false; }
      return reply.send({ ok: true });
    }
    if (room.ranked) return reply.code(409).send({ error: "A ranked game has no rematch: join the pool again" });
    if (room.left[1 - seat]) return reply.code(409).send({ error: "Your opponent has left" });
    room.rematch[seat] = true;
    room.touchedAt = Date.now();
    if (room.rematch[0] && room.rematch[1] && !room.next) {
      const next = newRoom(Date.now(), { format: room.format, type: room.type, note: "", password: "", seats: [...room.seats] });
      rooms.set(next.code, next);
      room.next = next.code;
    }
    return reply.send({ ok: true });
  });

  // the end of a game, reported by each browser. The server does not run the
  // engine, so a game counts only if both say the same winner, and only once.
  // Each report may carry the game's record: the first good one becomes the replay.
  app.post("/api/rooms/:code/result", { bodyLimit: RECORD_BODY_LIMIT, ...limit(20, "10 minutes") }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (!room) return reply.code(404).send({ error: "This game no longer exists" });
    const seat = seatOf(room, user.id);
    if (seat < 0) return reply.code(403).send({ error: "You are not in this game" });
    if (!room.seats[1]) return reply.code(409).send({ error: "The game has not started" });
    // a ranked game is the server's to judge: a browser's word changes nothing
    if (room.ranked) return reply.send({ recorded: room.recorded, replayId: room.replayId });
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid result" });
    room.results[seat] ??= parsed.data.winner;
    if (!room.recorded && !room.record && req.body?.record) room.record = roomRecord(room, req.body.record);
    const agreed = room.results[0] !== null && room.results[0] === room.results[1];
    if (agreed && !room.recorded) {
      room.recorded = true;
      await recordFriendGame(room);
    }
    return reply.send({ recorded: room.recorded, replayId: room.replayId });
  });

  // only the host, and only before anyone joined: a started game stays for both
  app.delete("/api/rooms/:code", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const room = rooms.get(roomCode(req));
    if (room && seatOf(room, user.id) === 0 && !room.seats[1]) rooms.delete(room.code);
    return reply.send({ ok: true });
  });
}
