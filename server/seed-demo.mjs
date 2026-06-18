// seed-demo.mjs — create demo captains (accounts + profiles), attach REAL
// decklists scraped from egmanevents, and generate a REAL match history between
// them (so Duel Records, My Statistics, and Rankings are all real & consistent).
//
//   npm run seed:demo
//
// Idempotent: existing captains are kept; decks/matches are only added if missing.
// All demo accounts share the password below (prototype only). "captain" is the
// dedicated test account used by the "Enter as Test Captain" button.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initDb } from "./db.mjs";
import { hashPassword, createUser, getUserByUsername } from "./auth.mjs";
import { updateProfile, createDeck, listDecks, countDecks, countMatches, createMatchesBatch,
  sendFriendRequest, acceptFriend, sendMessage, friendshipBetween } from "./store.mjs";

await initDb();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASSWORD = "captain123";
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

// --- load scraped decklists ---
const popular = JSON.parse(readFileSync(join(__dirname, "..", "public", "data", "popular.json"), "utf8"));
const flat = [];
const seenLeader = new Set();
for (const reg of popular.regionals || []) {
  const fmt = (reg.name.match(/\[([^\]]+)\]/) || [])[1] || "";
  for (const d of reg.decks || []) {
    if (!d.leaderId || seenLeader.has(d.leaderId)) continue;
    seenLeader.add(d.leaderId);
    flat.push({ leaderId: d.leaderId, leaderName: d.leaderName || "", cards: (d.cards || []).map((c) => ({ id: c.id, count: c.count })), format: fmt, source: reg.name });
  }
}
console.log(`Loaded ${flat.length} distinct-leader decklists.`);

// --- demo captains (last one = the test account) ---
const CAPTAINS = [
  { username: "redhaired_saki", display: "Saki",  color: "#c0392b", supporter: true,  bio: "Aggro enjoyer. Red or nothing — turn 1 attack, turn 5 handshake.", decks: 2 },
  { username: "navigator_mika", display: "Mika",  color: "#2a6fdb", supporter: false, bio: "Control gremlin. I durdle, you scoop.",                           decks: 2 },
  { username: "wano_ren",       display: "Ren",   color: "#1f8a5b", supporter: false, bio: "Green ramp, big board, good vibes.",                              decks: 2 },
  { username: "bigmom_tomo",    display: "Tomo",  color: "#caa023", supporter: true,  bio: "Yellow life games are peak TCG. Fight me.",                       decks: 1 },
  { username: "shadow_kai",     display: "Kai",   color: "#7a3fa0", supporter: false, bio: "Purple ramp. DON!! go brrr.",                                     decks: 2 },
  { username: "baroque_lia",    display: "Lia",   color: "#2c3138", supporter: false, bio: "Black / Baroque control specialist.",                            decks: 1 },
  { username: "captain",        display: "Test Captain", color: "#e3b24c", supporter: true, bio: "Demo account — log in and look around the network.",        decks: 2 },
];

let cursor = 0;
const created = [];
const roster = []; // { id, username, leaders:[leaderId], deckIds:[{deckId, leaderId}] }

// ---- pass 1: users + profiles + decks ----
for (let i = 0; i < CAPTAINS.length; i++) {
  const c = CAPTAINS[i];
  let user = await getUserByUsername(c.username);
  if (!user) {
    const password_hash = await hashPassword(PASSWORD);
    user = await createUser({ email: `${c.username}@sailing.local`, username: c.username, password_hash, display_name: c.display });
    created.push(c.username);
  }

  let decks = await listDecks(user.id);
  if (decks.length === 0) {
    const assigned = [];
    for (let k = 0; k < c.decks; k++) {
      const src = flat[cursor++ % flat.length];
      const wins = 30 + ((i * 7 + k * 11) % 90);
      const losses = 14 + ((i * 5 + k * 3) % 60);
      const deck = await createDeck(user.id, {
        name: `${src.leaderName} (${src.format})`,
        leaderId: src.leaderId, leaderName: src.leaderName, cards: src.cards,
        format: src.format, source: src.source, fav: k === 0, wins, losses,
      });
      assigned.push(deck);
    }
    decks = assigned;
  }

  const wins = decks.reduce((a, d) => a + d.wins, 0);
  const losses = decks.reduce((a, d) => a + d.losses, 0);
  await updateProfile(user.id, {
    bio: c.bio, avatar_color: c.color, supporter: c.supporter ? 1 : 0,
    ...(decks[0]?.leader_id ? { favorite_leader: decks[0].leader_id } : {}),
    wins, losses,
  });

  roster.push({ id: user.id, username: c.username, leaders: decks.map((d) => d.leader_id).filter(Boolean), decks });
}

// ---- pass 2: generate a real match history (only for captains with none) ----
const SPREAD = 1000 * 60 * 60 * 24 * 30; // last 30 days
let totalMatches = 0;
for (const r of roster) {
  if ((await countMatches(r.id)) > 0) continue;
  const opponents = roster.filter((o) => o.id !== r.id);
  const rows = [];
  for (const d of r.decks) {
    const results = [...Array(d.wins).fill("win"), ...Array(d.losses).fill("loss")];
    for (const result of results) {
      const opp = pick(opponents);
      const oppLeader = opp.leaders.length ? pick(opp.leaders) : null;
      const onPlay = Math.random() < 0.5;
      const points = result === "win" ? 8 + rnd(15) : -(4 + rnd(9));
      rows.push({
        userId: r.id, oppUserId: opp.id, myDeckId: d.id, myLeaderId: d.leader_id,
        oppLeaderId: oppLeader, result, onPlay, points, format: d.format,
        createdAt: Date.now() - rnd(SPREAD),
      });
    }
  }
  await createMatchesBatch(rows);
  totalMatches += rows.length;
  console.log(`• ${r.username.padEnd(16)} ${rows.length} matches`);
}

// ---- pass 3: friendships + a few messages (only if there are none yet) ----
const captain = roster.find((r) => r.username === "captain");
if (captain) {
  // captain is friends with saki and mika; pending request from ren; outgoing to kai
  const friendOf = ["redhaired_saki", "navigator_mika"];
  for (const u of friendOf) {
    const other = roster.find((r) => r.username === u);
    if (!other) continue;
    const existing = await friendshipBetween(captain.id, other.id);
    if (!existing) {
      const f = await sendFriendRequest(captain.id, other.id);
      if (f.status !== "accepted") await acceptFriend(other.id, f.id); // simulate accept
    }
  }
  const ren = roster.find((r) => r.username === "wano_ren");
  if (ren) {
    const existing = await friendshipBetween(ren.id, captain.id);
    if (!existing) await sendFriendRequest(ren.id, captain.id); // pending → captain's inbox
  }
  const kai = roster.find((r) => r.username === "shadow_kai");
  if (kai) {
    const existing = await friendshipBetween(captain.id, kai.id);
    if (!existing) await sendFriendRequest(captain.id, kai.id); // pending → outgoing
  }

  // a few real messages so the inbox isn't empty on first visit
  const saki = roster.find((r) => r.username === "redhaired_saki");
  const mika = roster.find((r) => r.username === "navigator_mika");
  if (saki) {
    await sendMessage(saki.id, captain.id, "gg captain! that last attack got me 😭");
    await sendMessage(captain.id, saki.id, "haha the Don rush was clutch — rematch tomorrow?");
    await sendMessage(saki.id, captain.id, "you're on. bring the Enel list.");
  }
  if (mika) {
    await sendMessage(mika.id, captain.id, "hey, want to test my Bonney build?");
  }
}

console.log(`\nDone. ${created.length} new account(s), ${totalMatches} matches generated.`);
console.log(`Demo password: ${PASSWORD}  ·  test account: captain / ${PASSWORD}`);
process.exit(0);
