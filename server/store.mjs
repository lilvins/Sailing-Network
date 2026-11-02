// store.mjs — profiles + decks data access (async, libsql).

import { randomUUID } from "node:crypto";
import db, { get, all, run } from "./db.mjs";
import { ladderRating } from "./stats/index.mjs";

// ---------- profiles ----------
export async function ensureProfile(userId) {
  const existing = await get(`SELECT * FROM profiles WHERE user_id=?`, [userId]);
  if (existing) return existing;
  await run(`INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)`, [userId, Date.now()]);
  return get(`SELECT * FROM profiles WHERE user_id=?`, [userId]);
}

export async function updateProfile(userId, fields) {
  await ensureProfile(userId);
  const cols = [];
  const args = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k}=?`);
    args.push(v);
  }
  if (!cols.length) return get(`SELECT * FROM profiles WHERE user_id=?`, [userId]);
  cols.push(`updated_at=?`);
  args.push(Date.now(), userId);
  await run(`UPDATE profiles SET ${cols.join(", ")} WHERE user_id=?`, args);
  return get(`SELECT * FROM profiles WHERE user_id=?`, [userId]);
}

export const profileToClient = (p) =>
  p && {
    bio: p.bio,
    avatarColor: p.avatar_color,
    favoriteLeader: p.favorite_leader,
    supporter: !!p.supporter,
    country: p.country || "",
    wins: p.wins,
    losses: p.losses,
  };

// ---------- decks ----------
export async function createDeck(userId, { name, leaderId, leaderName, cards, format, source, fav, wins, losses }) {
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO decks (id,user_id,name,leader_id,leader_name,cards,format,source,fav,wins,losses,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      name,
      leaderId ?? null,
      leaderName ?? "",
      JSON.stringify(cards ?? []),
      format ?? "",
      source ?? "",
      fav ? 1 : 0,
      wins ?? 0,
      losses ?? 0,
      now,
      now,
    ]
  );
  return getDeck(id);
}

export const getDeck = (id) => get(`SELECT * FROM decks WHERE id=?`, [id]);
export const listDecks = (userId) => all(`SELECT * FROM decks WHERE user_id=? ORDER BY updated_at DESC`, [userId]);
export const countDecks = async (userId) => Number((await get(`SELECT COUNT(*) AS c FROM decks WHERE user_id=?`, [userId])).c);

const DECK_COL = { leaderId: "leader_id", leaderName: "leader_name" };
export async function updateDeck(id, fields) {
  const cols = [];
  const args = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${DECK_COL[k] || k}=?`);
    args.push(k === "cards" ? JSON.stringify(v) : k === "fav" ? (v ? 1 : 0) : v);
  }
  if (!cols.length) return getDeck(id);
  cols.push(`updated_at=?`);
  args.push(Date.now(), id);
  await run(`UPDATE decks SET ${cols.join(", ")} WHERE id=?`, args);
  return getDeck(id);
}

export const deleteDeck = (id) => run(`DELETE FROM decks WHERE id=?`, [id]);

export const deckToClient = (d) =>
  d && {
    id: d.id,
    userId: d.user_id,
    name: d.name,
    leaderId: d.leader_id,
    leaderName: d.leader_name,
    cards: JSON.parse(d.cards || "[]"),
    format: d.format,
    source: d.source,
    fav: !!d.fav,
    wins: d.wins,
    losses: d.losses,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };

// ---------- matches ----------
export const countMatches = async (uid) => Number((await get(`SELECT COUNT(*) AS c FROM matches WHERE user_id=?`, [uid])).c);

export async function createMatchesBatch(rows) {
  const stmts = rows.map((m) => ({
    sql: `INSERT INTO matches (id,user_id,opp_user_id,my_deck_id,my_leader_id,opp_leader_id,result,on_play,points,format,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [randomUUID(), m.userId, m.oppUserId ?? null, m.myDeckId ?? null, m.myLeaderId ?? null, m.oppLeaderId ?? null, m.result, m.onPlay ? 1 : 0, m.points ?? 0, m.format ?? "", m.createdAt],
  }));
  for (let i = 0; i < stmts.length; i += 400) {
    await db.batch(stmts.slice(i, i + 400), "write");
  }
}

export async function createMatch({ userId, oppUserId, myDeckId, myLeaderId, oppLeaderId, result, onPlay, format, source = "manual" }) {
  const id = randomUUID();
  const now = Date.now();
  const win = result === "win";
  await run(
    `INSERT INTO matches (id,user_id,opp_user_id,my_deck_id,my_leader_id,opp_leader_id,result,on_play,points,format,source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, oppUserId ?? null, myDeckId ?? null, myLeaderId ?? null, oppLeaderId ?? null, result, onPlay ? 1 : 0, win ? 10 : -5, format ?? "", source, now],
  );
  // keep deck + profile win/loss totals in sync
  if (myDeckId) await run(`UPDATE decks SET ${win ? "wins=wins+1" : "losses=losses+1"} WHERE id=?`, [myDeckId]);
  await run(`UPDATE profiles SET ${win ? "wins=wins+1" : "losses=losses+1"}, updated_at=? WHERE user_id=?`, [now, userId]);
  return get(
    `SELECT m.*, ou.username AS opp_username, ou.display_name AS opp_display, d.name AS my_deck_name
     FROM matches m LEFT JOIN users ou ON ou.id=m.opp_user_id LEFT JOIN decks d ON d.id=m.my_deck_id
     WHERE m.id=?`,
    [id],
  );
}

// recent matches (with opponent + deck names) for the Duel Records table
export const listMatches = (uid, limit = 60) =>
  all(
    `SELECT m.*, ou.username AS opp_username, ou.display_name AS opp_display, d.name AS my_deck_name
     FROM matches m
     LEFT JOIN users ou ON ou.id = m.opp_user_id
     LEFT JOIN decks d ON d.id = m.my_deck_id
     WHERE m.user_id=? ORDER BY m.created_at DESC LIMIT ?`,
    [uid, limit]
  );

// all matches (lean) for stats aggregation
export const allMatches = (uid) =>
  all(`SELECT my_deck_id, my_leader_id, opp_leader_id, result, on_play, created_at FROM matches WHERE user_id=?`, [uid]);

export const matchToClient = (m) => ({
  id: m.id,
  opponent: { username: m.opp_username || null, displayName: m.opp_display || "Unknown" },
  myDeckId: m.my_deck_id,
  myDeckName: m.my_deck_name || "",
  myLeaderId: m.my_leader_id,
  oppLeaderId: m.opp_leader_id,
  result: m.result,
  onPlay: !!m.on_play,
  points: m.points,
  format: m.format,
  createdAt: m.created_at,
});

// ---------- friendships ----------
// directional storage; `friendStatusWith` resolves either side
export async function friendshipBetween(a, b) {
  return get(
    `SELECT * FROM friendships
     WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`,
    [a, b, b, a]
  );
}

export async function sendFriendRequest(fromId, toId) {
  if (fromId === toId) throw new Error("Cannot friend yourself");
  const existing = await friendshipBetween(fromId, toId);
  if (existing) {
    if (existing.status === "accepted") return existing;
    // if the other side already sent a pending request, accept it
    if (existing.addressee_id === fromId && existing.status === "pending") {
      await run(`UPDATE friendships SET status='accepted', updated_at=? WHERE id=?`, [Date.now(), existing.id]);
      return get(`SELECT * FROM friendships WHERE id=?`, [existing.id]);
    }
    return existing; // already pending from me
  }
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    [id, fromId, toId, now, now]
  );
  return get(`SELECT * FROM friendships WHERE id=?`, [id]);
}

export async function acceptFriend(myId, friendshipId) {
  const f = await get(`SELECT * FROM friendships WHERE id=?`, [friendshipId]);
  if (!f) throw new Error("not found");
  if (f.addressee_id !== myId) throw new Error("not your request to accept");
  if (f.status !== "pending") throw new Error("not pending");
  await run(`UPDATE friendships SET status='accepted', updated_at=? WHERE id=?`, [Date.now(), f.id]);
  return get(`SELECT * FROM friendships WHERE id=?`, [f.id]);
}

export async function deleteFriendship(myId, friendshipId) {
  const f = await get(`SELECT * FROM friendships WHERE id=?`, [friendshipId]);
  if (!f) return false;
  if (f.requester_id !== myId && f.addressee_id !== myId) throw new Error("not yours");
  await run(`DELETE FROM friendships WHERE id=?`, [f.id]);
  return true;
}

// flatten the directional rows into a per-user list with role/status
export async function listFriends(myId) {
  return all(
    `SELECT f.id, f.status, f.created_at, f.updated_at,
            CASE WHEN f.requester_id=? THEN 'outgoing' ELSE 'incoming' END AS role,
            u.id AS other_id, u.username, u.display_name, u.role AS other_role
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.requester_id=? OR f.addressee_id=?
     ORDER BY f.updated_at DESC`,
    [myId, myId, myId, myId]
  );
}

export const friendshipToClient = (f) =>
  f && {
    id: f.id,
    status: f.status,           // 'pending' | 'accepted'
    role: f.role,               // 'incoming' | 'outgoing'
    user: { id: f.other_id, username: f.username, displayName: f.display_name, role: f.other_role },
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };

// ---------- messages ----------
export async function sendMessage(fromId, toId, body) {
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO messages (id, from_user_id, to_user_id, body, created_at) VALUES (?,?,?,?,?)`,
    [id, fromId, toId, body, now]
  );
  return get(`SELECT * FROM messages WHERE id=?`, [id]);
}

// conversations list — last message per peer + unread count addressed to me
export async function listThreads(myId) {
  return all(
    `WITH pairs AS (
       SELECT
         CASE WHEN from_user_id=? THEN to_user_id ELSE from_user_id END AS peer_id,
         body, created_at, from_user_id, to_user_id, read_at
       FROM messages
       WHERE from_user_id=? OR to_user_id=?
     ),
     last AS (
       SELECT peer_id, body, created_at, from_user_id
       FROM pairs
       WHERE created_at = (SELECT MAX(p2.created_at) FROM pairs p2 WHERE p2.peer_id = pairs.peer_id)
     ),
     unread AS (
       SELECT from_user_id AS peer_id, COUNT(*) AS unread
       FROM messages
       WHERE to_user_id=? AND read_at IS NULL
       GROUP BY from_user_id
     )
     SELECT u.id AS peer_id, u.username, u.display_name,
            l.body AS last_body, l.created_at AS last_at, l.from_user_id AS last_from,
            COALESCE(ur.unread, 0) AS unread
     FROM last l
     JOIN users u ON u.id = l.peer_id
     LEFT JOIN unread ur ON ur.peer_id = u.id
     ORDER BY l.created_at DESC`,
    [myId, myId, myId, myId]
  );
}

export const threadToClient = (t) => ({
  peer: { id: t.peer_id, username: t.username, displayName: t.display_name },
  lastBody: t.last_body,
  lastAt: t.last_at,
  lastFromMe: undefined, // filled by route (needs my id)
  unread: Number(t.unread),
});

export async function listMessagesWith(myId, peerId, limit = 200) {
  return all(
    `SELECT id, from_user_id, to_user_id, body, created_at, read_at
     FROM messages
     WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)
     ORDER BY created_at ASC
     LIMIT ?`,
    [myId, peerId, peerId, myId, limit]
  );
}

export async function markThreadRead(myId, peerId) {
  await run(
    `UPDATE messages SET read_at=? WHERE to_user_id=? AND from_user_id=? AND read_at IS NULL`,
    [Date.now(), myId, peerId]
  );
}

export const messageToClient = (m, myId) => ({
  id: m.id,
  fromMe: m.from_user_id === myId,
  body: m.body,
  createdAt: m.created_at,
  readAt: m.read_at,
});

// lightweight summary (no full card list) for profile/directory views
export const deckSummary = (d) =>
  d && {
    id: d.id,
    name: d.name,
    leaderId: d.leader_id,
    leaderName: d.leader_name,
    count: JSON.parse(d.cards || "[]").reduce((a, c) => a + (c.count || 0), 0),
    format: d.format,
    fav: !!d.fav,
    wins: d.wins,
    losses: d.losses,
  };

// ---------- presence ----------
export async function setUserPresence(userId, status, sessionId = null) {
  const now = Date.now();
  await run(
    `INSERT INTO user_presence (user_id, status, session_id, last_seen, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET status=?, session_id=?, last_seen=?, updated_at=?`,
    [userId, status, sessionId, now, now, status, sessionId, now, now]
  );
  return get(`SELECT * FROM user_presence WHERE user_id=?`, [userId]);
}

export async function getUserPresence(userId) {
  return get(`SELECT * FROM user_presence WHERE user_id=?`, [userId]);
}

export async function getPresenceOfFriends(myId) {
  const rows = await all(
    `SELECT p.* FROM user_presence p
     WHERE p.user_id IN (
       SELECT CASE
         WHEN requester_id=? THEN addressee_id
         ELSE requester_id
       END as friend_id
       FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'
     )`,
    [myId, myId, myId]
  );
  const map = {};
  for (const p of rows) {
    map[p.user_id] = effectivePresence(p); // stale heartbeats read as offline
  }
  return map;
}

export const presenceToClient = (p) =>
  p && {
    status: p.status,
    lastSeen: p.last_seen,
    updatedAt: p.updated_at,
  };

// ---------- match system (v3) ----------
export async function createMatchSession(hostUserId, deckId) {
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO match_sessions (id, host_user_id, host_deck_id, status, created_at)
     VALUES (?, ?, ?, 'waiting', ?)`,
    [id, hostUserId, deckId, now]
  );
  return getMatchSession(id);
}

export async function getMatchSession(sessionId) {
  return get(`SELECT * FROM match_sessions WHERE id=?`, [sessionId]);
}

export async function joinMatchSession(sessionId, opponentUserId, deckId) {
  const session = await getMatchSession(sessionId);
  if (!session || session.status !== 'waiting' || session.opponent_id) return null;

  // Randomly decide who goes first
  const hostOnPlay = Math.random() < 0.5 ? 1 : 0;
  const now = Date.now();

  await run(
    `UPDATE match_sessions
     SET opponent_id=?, opponent_deck_id=?, host_on_play=?, status='active', started_at=?
     WHERE id=?`,
    [opponentUserId, deckId, hostOnPlay, now, sessionId]
  );
  return getMatchSession(sessionId);
}

// One player's word about who won. Nothing counts until both have reported: if
// they agree the game is completed, if not it is cancelled and writes no result.
// A player can correct their own report until then.
export async function reportMatchResult(session, userId, winnerId) {
  const col = userId === session.host_user_id ? "host_report" : "opponent_report";
  await run(`UPDATE match_sessions SET ${col}=? WHERE id=? AND status='active'`, [winnerId, session.id]);
  const s = await getMatchSession(session.id);
  if (!s.host_report || !s.opponent_report) return s;
  return s.host_report === s.opponent_report ? completeMatchSession(s.id, s.host_report) : cancelMatchSession(s.id);
}

// A session from the ranked queue (matched_at set) becomes two `matches` rows,
// which is what the ladder reads. Session and rows are written in one batch: all
// or nothing, so a failed write can be retried. The row ids come from the session
// id, so two players reporting the same game can't count it twice.
export async function completeMatchSession(sessionId, winnerId) {
  const now = Date.now();
  const s = await getMatchSession(sessionId);
  const stmts = [{
    sql: `UPDATE match_sessions SET status='completed', winner_id=?, completed_at=? WHERE id=? AND status='active'`,
    args: [winnerId, now, sessionId],
  }];
  if (s.matched_at) stmts.push(...(await rankedResultStatements(s, winnerId, now)));
  await db.batch(stmts, "write");
  return getMatchSession(sessionId);
}

async function rankedResultStatements(s, winnerId, now) {
  const hostDeck = s.host_deck_id ? await get(`SELECT * FROM decks WHERE id=?`, [s.host_deck_id]) : null;
  const oppDeck = s.opponent_deck_id ? await get(`SELECT * FROM decks WHERE id=?`, [s.opponent_deck_id]) : null;
  const row = (seat, userId, oppUserId, deck, theirDeck, onPlay) => {
    const win = winnerId === userId;
    const counter = win ? "wins=wins+1" : "losses=losses+1";
    return [
      {
        sql: `INSERT INTO matches (id,user_id,opp_user_id,my_deck_id,my_leader_id,opp_leader_id,result,on_play,points,format,source,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,'ranked',?)`,
        args: [`${s.id}:${seat}`, userId, oppUserId, deck?.id ?? null, deck?.leader_id ?? null, theirDeck?.leader_id ?? null,
          win ? "win" : "loss", onPlay ? 1 : 0, win ? 10 : -5, deck?.format ?? "", now],
      },
      ...(deck ? [{ sql: `UPDATE decks SET ${counter} WHERE id=?`, args: [deck.id] }] : []),
      { sql: `UPDATE profiles SET ${counter}, updated_at=? WHERE user_id=?`, args: [now, userId] },
    ];
  };
  return [
    ...row("host", s.host_user_id, s.opponent_id, hostDeck, oppDeck, !!s.host_on_play),
    ...row("opp", s.opponent_id, s.host_user_id, oppDeck, hostDeck, !s.host_on_play),
  ];
}

// A game with no result (abandoned, or it could not finish): closes the session,
// writes no match row.
export async function cancelMatchSession(sessionId) {
  await run(
    `UPDATE match_sessions SET status='cancelled', completed_at=? WHERE id=? AND status IN ('pending','active')`,
    [Date.now(), sessionId]
  );
  return getMatchSession(sessionId);
}

export async function listActiveMatches() {
  return all(
    `SELECT ms.*, h.username AS host_username, o.username AS opp_username
     FROM match_sessions ms
     JOIN users h ON ms.host_user_id = h.id
     LEFT JOIN users o ON ms.opponent_id = o.id
     WHERE ms.status IN ('waiting', 'active')
     ORDER BY ms.created_at DESC`
  );
}

export async function getUserMatches(userId) {
  return all(
    `SELECT ms.*, h.username AS host_username, o.username AS opp_username
     FROM match_sessions ms
     JOIN users h ON ms.host_user_id = h.id
     LEFT JOIN users o ON ms.opponent_id = o.id
     WHERE ms.host_user_id=? OR ms.opponent_id=?
     ORDER BY ms.created_at DESC`,
    [userId, userId]
  );
}

export const matchSessionToClient = (ms) =>
  ms && {
    id: ms.id,
    hostUserId: ms.host_user_id,
    hostUsername: ms.host_username,
    opponentId: ms.opponent_id,
    opponentUsername: ms.opp_username,
    hostDeckId: ms.host_deck_id,
    opponentDeckId: ms.opponent_deck_id,
    status: ms.status,
    hostOnPlay: !!ms.host_on_play,
    hostReady: !!ms.host_ready,
    opponentReady: !!ms.opponent_ready,
    winnerId: ms.winner_id,
    createdAt: ms.created_at,
    matchedAt: ms.matched_at,
    startedAt: ms.started_at,
    completedAt: ms.completed_at,
  };

// ---------- match queue (ranked) ----------
export async function joinQueue(userId, deckId, rating = 1000) {
  const now = Date.now();
  await run(
    `INSERT INTO match_queue (user_id, deck_id, rating, joined_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET deck_id=?, rating=?, joined_at=?`,
    [userId, deckId, rating, now, deckId, rating, now]
  );
  return get(`SELECT * FROM match_queue WHERE user_id=?`, [userId]);
}

export async function leaveQueue(userId) {
  await run(`DELETE FROM match_queue WHERE user_id=?`, [userId]);
}

export async function getQueuedPlayers() {
  return all(`SELECT * FROM match_queue ORDER BY rating DESC`);
}

// Simple matchmaking: find player closest in rating (within ±200 points).
// Kept for callers that want a single-opponent lookup (e.g. host/join lobby).
export async function findOpponentForQueue(userId, userRating) {
  const ratingRange = 200;
  const opponent = await get(
    `SELECT * FROM match_queue
     WHERE user_id != ? AND rating BETWEEN ? AND ?
     ORDER BY ABS(rating - ?) ASC LIMIT 1`,
    [userId, userRating - ratingRange, userRating + ratingRange, userRating]
  );
  return opponent;
}

// ---------- matchmaking (auto-pairing) ----------
// Tunables. RATING_WINDOW is the normal pairing tolerance; once an entry has
// been waiting longer than WAIT_TIMEOUT_MS we pair it with anyone (best-effort
// closest rating). NO_SHOW_TIMEOUT_MS is how long a 'pending' match waits for
// both players to confirm presence before it is cancelled and they re-queue.
export const RATING_WINDOW = 200;
export const WAIT_TIMEOUT_MS = 30 * 1000;
export const NO_SHOW_TIMEOUT_MS = 60 * 1000;
export const ACTIVE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// Create a match_session for an already-decided pair. The lower-rated player is
// the "host" arbitrarily; both ids are recorded up front. Starts as 'pending':
// both players must be seen (frontend loads the match) before it goes 'active'.
export async function createMatchedSession(a, b) {
  const id = randomUUID();
  const now = Date.now();
  const hostOnPlay = Math.random() < 0.5 ? 1 : 0;
  await run(
    `INSERT INTO match_sessions
       (id, host_user_id, opponent_id, host_deck_id, opponent_deck_id,
        status, host_on_play, created_at, matched_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, a.user_id, b.user_id, a.deck_id, b.deck_id, hostOnPlay, now, now]
  );
  return getMatchSession(id);
}

// Core algorithm. Pulls every queued entry (oldest first so long-waiters get
// priority), then greedily pairs each unmatched entry with the best remaining
// candidate inside the rating window — or, if the entry has timed out, with the
// closest remaining candidate regardless of window. Paired users are removed
// from the queue and a 'pending' match_session is created for each pair.
// Returns the list of created sessions. Safe to call repeatedly (idempotent:
// it only ever consumes whatever is currently queued).
export async function findAndPairMatches() {
  const now = Date.now();
  const queue = await all(
    `SELECT q.*, u.is_bot FROM match_queue q JOIN users u ON u.id = q.user_id ORDER BY q.joined_at ASC`
  );
  const created = [];
  const taken = new Set();

  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (taken.has(a.user_id)) continue;

    const aTimedOut = now - a.joined_at >= WAIT_TIMEOUT_MS;
    let best = null;
    let bestDiff = Infinity;

    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (taken.has(b.user_id)) continue;
      // a person is never handed an AI opponent without knowing it
      if (a.is_bot !== b.is_bot) continue;
      const diff = Math.abs(a.rating - b.rating);
      // candidate is eligible if within window, OR either side has timed out
      const bTimedOut = now - b.joined_at >= WAIT_TIMEOUT_MS;
      const eligible = diff <= RATING_WINDOW || aTimedOut || bTimedOut;
      if (eligible && diff < bestDiff) {
        best = b;
        bestDiff = diff;
      }
    }

    if (best) {
      taken.add(a.user_id);
      taken.add(best.user_id);
      // remove both from queue, then create the pending session
      await run(`DELETE FROM match_queue WHERE user_id IN (?, ?)`, [
        a.user_id,
        best.user_id,
      ]);
      const session = await createMatchedSession(a, best);
      created.push(session);
    }
  }
  return created;
}

// Look up where a user stands: are they queued, already matched, or idle?
// Returns one of:
//   { state: 'matched', session }                  -> a pending/active session exists
//   { state: 'waiting', position, total, waitMs }  -> still in queue
//   { state: 'idle' }                              -> neither
export async function getQueueStatus(userId) {
  // A live (pending or active) session this user belongs to takes priority.
  const session = await get(
    `SELECT ms.*, h.username AS host_username, o.username AS opp_username
       FROM match_sessions ms
       JOIN users h ON ms.host_user_id = h.id
       LEFT JOIN users o ON ms.opponent_id = o.id
      WHERE (ms.host_user_id = ? OR ms.opponent_id = ?)
        AND ms.status IN ('pending', 'active')
      ORDER BY ms.created_at DESC
      LIMIT 1`,
    [userId, userId]
  );
  if (session) return { state: "matched", session };

  const entry = await get(`SELECT * FROM match_queue WHERE user_id=?`, [userId]);
  if (!entry) return { state: "idle" };

  // 1-based position by FIFO order (who joined earliest is #1).
  const ahead = await get(
    `SELECT COUNT(*) AS n FROM match_queue WHERE joined_at < ?`,
    [entry.joined_at]
  );
  const total = await get(`SELECT COUNT(*) AS n FROM match_queue`);
  return {
    state: "waiting",
    position: Number(ahead.n) + 1,
    total: Number(total.n),
    waitMs: Date.now() - entry.joined_at,
  };
}

// Mark a player present for their pending match. Once both sides are ready the
// session flips to 'active' and started_at is stamped. Returns the session.
export async function markMatchReady(sessionId, userId) {
  const session = await getMatchSession(sessionId);
  if (!session) return null;
  if (userId !== session.host_user_id && userId !== session.opponent_id) return null;
  if (session.status !== "pending" && session.status !== "active") return session;

  const col = userId === session.host_user_id ? "host_ready" : "opponent_ready";
  await run(`UPDATE match_sessions SET ${col}=1 WHERE id=?`, [sessionId]);

  const fresh = await getMatchSession(sessionId);
  if (fresh.status === "pending" && fresh.host_ready && fresh.opponent_ready) {
    await run(
      `UPDATE match_sessions SET status='active', started_at=? WHERE id=?`,
      [Date.now(), sessionId]
    );
    return getMatchSession(sessionId);
  }
  return fresh;
}

// Cancel any 'pending' match where ≥1 player never showed within the no-show
// window. The player(s) who DID confirm are put back into the queue so they
// don't get punished for the opponent's no-show. An 'active' game nobody finished
// is cancelled too, or its players would stay "matched" forever.
// Returns count cancelled.
export async function expireStaleMatches() {
  await run(
    `UPDATE match_sessions SET status='cancelled', completed_at=? WHERE status='active' AND started_at < ?`,
    [Date.now(), Date.now() - ACTIVE_TIMEOUT_MS]
  );
  const cutoff = Date.now() - NO_SHOW_TIMEOUT_MS;
  const stale = await all(
    `SELECT * FROM match_sessions
      WHERE status='pending' AND matched_at IS NOT NULL AND matched_at < ?`,
    [cutoff]
  );
  for (const s of stale) {
    await run(
      `UPDATE match_sessions SET status='cancelled', completed_at=? WHERE id=?`,
      [Date.now(), s.id]
    );
    // Re-queue whichever side confirmed but got stood up.
    const now = Date.now();
    if (s.host_ready) {
      await run(
        `INSERT INTO match_queue (user_id, deck_id, rating, joined_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`,
        [s.host_user_id, s.host_deck_id, await ladderRating(s.host_user_id), now]
      );
    }
    if (s.opponent_ready && s.opponent_id) {
      await run(
        `INSERT INTO match_queue (user_id, deck_id, rating, joined_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`,
        [s.opponent_id, s.opponent_deck_id, await ladderRating(s.opponent_id), now]
      );
    }
  }
  return stale.length;
}

// Format a wait time as the API's "Xm" estimate. Rounds up to whole minutes,
// floors at "1m" while waiting.
export function estimateWaitLabel(positionAhead) {
  // Rough heuristic with no game engine: ~one pairing per tick, pairs consume
  // 2 players, ticks are 5s. So ETA ≈ ceil(positionAhead/2) ticks.
  const ticks = Math.ceil(Math.max(0, positionAhead) / 2);
  const seconds = Math.max(5, ticks * 5);
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes}m`;
}

// ---------- ratings (for ranked) ----------
export async function ensureRating(userId) {
  const existing = await get(`SELECT * FROM user_ratings WHERE user_id=?`, [userId]);
  if (existing) return existing;

  const now = Date.now();
  await run(
    `INSERT INTO user_ratings (user_id, rating, rd, vol, updated_at)
     VALUES (?, 1000, 350, 0.06, ?)`,
    [userId, now]
  );
  return get(`SELECT * FROM user_ratings WHERE user_id=?`, [userId]);
}

export async function getRating(userId) {
  return ensureRating(userId);
}

export async function updateRating(userId, newRating, newRd, newVol) {
  const now = Date.now();
  await run(
    `UPDATE user_ratings SET rating=?, rd=?, vol=?, updated_at=? WHERE user_id=?`,
    [newRating, newRd, newVol, now, userId]
  );
  return get(`SELECT * FROM user_ratings WHERE user_id=?`, [userId]);
}

// ---------- presence reliability ----------
// If a user's last heartbeat is older than this, treat them as offline even if
// their stored status says otherwise (covers tabs closed without logout).
export const PRESENCE_STALE_MS = 70 * 1000;
export function effectivePresence(p) {
  if (!p) return { status: "offline", lastSeen: 0, updatedAt: 0 };
  const stale = p.status !== "offline" && Date.now() - p.last_seen > PRESENCE_STALE_MS;
  return { status: stale ? "offline" : p.status, lastSeen: p.last_seen, updatedAt: p.updated_at };
}

// ---------- global chat ----------
export async function postGlobalMessage(userId, body) {
  const id = randomUUID();
  await run(`INSERT INTO global_messages (id, user_id, body, created_at) VALUES (?,?,?,?)`, [id, userId, body, Date.now()]);
  return get(`SELECT * FROM global_messages WHERE id=?`, [id]);
}

// newest `limit` messages, returned oldest-first, joined with author info
export async function listGlobalMessages(limit = 80) {
  const rows = await all(
    `SELECT g.id, g.user_id, g.body, g.created_at,
            u.username, u.display_name, p.avatar_color, p.favorite_leader
     FROM global_messages g
     JOIN users u ON u.id = g.user_id
     LEFT JOIN profiles p ON p.user_id = g.user_id
     ORDER BY g.created_at DESC LIMIT ?`,
    [limit]
  );
  return rows.reverse();
}

export const globalMessageToClient = (m, myId) => ({
  id: m.id,
  fromMe: m.user_id === myId,
  username: m.username,
  displayName: m.display_name,
  avatarColor: m.avatar_color || "#7a3030",
  favoriteLeader: m.favorite_leader || null,
  body: m.body,
  createdAt: m.created_at,
});

// ---------- notifications ----------
export async function createNotification({ userId, type, actorId = null, body = "", ref = null }) {
  if (!userId) return;
  const id = randomUUID();
  await run(
    `INSERT INTO notifications (id, user_id, type, actor_id, body, ref, created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, userId, type, actorId, body, ref, Date.now()]
  );
}

export async function listNotifications(userId, limit = 40) {
  return all(
    `SELECT n.*, a.username AS actor_username, a.display_name AS actor_display
     FROM notifications n
     LEFT JOIN users a ON a.id = n.actor_id
     WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT ?`,
    [userId, limit]
  );
}

export const countUnreadNotifications = async (userId) =>
  Number((await get(`SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read_at IS NULL`, [userId])).c);

export async function markNotificationsRead(userId) {
  await run(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL`, [Date.now(), userId]);
}

export const notificationToClient = (n) => ({
  id: n.id,
  type: n.type,
  body: n.body,
  ref: n.ref,
  read: n.read_at != null,
  actor: n.actor_username ? { username: n.actor_username, displayName: n.actor_display } : null,
  createdAt: n.created_at,
});

// ---------- bans ----------
// Ban a user. Any existing ban (active or expired) is replaced so the latest
// admin decision wins and there's only ever one row per user. `expiresAt` is a
// ms timestamp or null for a permanent ban.
export async function banUser(userId, bannedById, reason, expiresAt = null) {
  await run(`DELETE FROM bans WHERE user_id=?`, [userId]);
  const id = randomUUID();
  await run(
    `INSERT INTO bans (id, user_id, banned_by_id, reason, banned_at, expires_at)
     VALUES (?,?,?,?,?,?)`,
    [id, userId, bannedById ?? null, String(reason ?? "").slice(0, 200), Date.now(), expiresAt ?? null]
  );
  return get(`SELECT * FROM bans WHERE id=?`, [id]);
}

// Lift a ban (remove the row). Returns true if a ban existed.
export async function unbanUser(userId) {
  const res = await run(`DELETE FROM bans WHERE user_id=?`, [userId]);
  return (res.rowsAffected ?? 0) > 0;
}

// Returns the ban row if the user is currently banned (permanent, or expiry in
// the future), otherwise null. Expired bans never match, so login auto-reenables.
export async function getActiveBan(userId) {
  return get(
    `SELECT * FROM bans
     WHERE user_id=? AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY banned_at DESC LIMIT 1`,
    [userId, Date.now()]
  );
}

// All bans (admin view), newest first, joined with the banned user + admin.
export async function listBans() {
  return all(
    `SELECT b.*,
            u.username AS user_username, u.display_name AS user_display, u.email AS user_email,
            a.username AS admin_username, a.display_name AS admin_display
     FROM bans b
     JOIN users u ON u.id = b.user_id
     LEFT JOIN users a ON a.id = b.banned_by_id
     ORDER BY b.banned_at DESC`
  );
}

export const banToClient = (b) => ({
  id: b.id,
  userId: b.user_id,
  username: b.user_username,
  displayName: b.user_display,
  email: b.user_email,
  bannedById: b.banned_by_id,
  bannedByUsername: b.admin_username || null,
  reason: b.reason,
  bannedAt: b.banned_at,
  expiresAt: b.expires_at,             // null = permanent
  active: b.expires_at == null || b.expires_at > Date.now(),
});

// Meta analytics and the ranked ladder live in server/stats/.
