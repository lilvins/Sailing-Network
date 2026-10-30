import { describe, expect, it } from "vitest";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { AutoGameState, PID } from "../engine/state";
import { metaDecks, realDb } from "../__bench__/metaGames";

/**
 * Enel's DON!! choices are the player's (user report, 2026-10-30):
 * - DON!!−1 (OP15-060): with active AND rested DON!! on the field the player
 *   picks which go back (8-3-1-6) — no more "rested first" behind their back.
 * - Leader OP15-058: "give UP TO 4 rested DON!!" — giving fewer (or none) is legal.
 */
const ENEL_LEADER = "OP15-058";
const ENEL_060 = "OP15-060";
const FILLER = "OP15-118";

// the meta Enel list (public/data/meta-decks.json), its 4 OP15-071 swapped for 4 OP15-060
const ENEL_DECK = metaDecks.find((d) => d.leaderId === ENEL_LEADER)!.cards
  .flatMap((c) => Array<string>(c.count).fill(c.id === "OP15-071" ? ENEL_060 : c.id));

function newGame(): AutoGameState {
  const deck = ENEL_DECK;
  const config: GameConfig = {
    seed: "enel-don", firstPlayer: "alice",
    players: [{ id: "alice", leader: ENEL_LEADER, deck }, { id: "bob", leader: ENEL_LEADER, deck }],
  };
  let s = createGame(realDb, config).state;
  s = applyIntent(realDb, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(realDb, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}

/** Move one copy of a card from deck/hand straight onto the character area. */
function onField(s: AutoGameState, cardId: string, pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["hand", "deck"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) {
      const [iid] = p.zones[from].splice(i, 1);
      p.zones.characterArea.push(iid);
      return iid;
    }
  }
  throw new Error(`no ${cardId} for ${pid}`);
}

const activateIndex = (cardId: string) =>
  realDb(cardId).compiled!.effects.findIndex((e) => e.timing === "activateMain");

describe("Enel: DON!! choices stay with the player", () => {
  it("DON!!−1 with active and rested DON!! asks which to return", () => {
    const s = newGame();
    const iid = onField(s, ENEL_060);
    Object.assign(s.players.alice.don, { active: 2, rested: 2, deck: s.players.alice.don.deck - 4 });
    const after = applyIntent(realDb, s, { type: "activateMain", player: "alice", iid, effectIndex: activateIndex(ENEL_060) }).state;
    expect(after.pendingChoice).toMatchObject({ kind: "payDon", player: "alice", amount: 1 });
    // the player keeps the rested one and gives back an ACTIVE DON!!
    const paid = applyIntent(realDb, after, { type: "respondPayDon", player: "alice", fromActive: 1, fromRested: 0, fromGiven: {} }).state;
    expect(paid.players.alice.don).toMatchObject({ active: 1, rested: 2 });
  });

  it("DON!!−1 with only rested DON!! is paid without asking", () => {
    const s = newGame();
    const iid = onField(s, ENEL_060);
    Object.assign(s.players.alice.don, { active: 0, rested: 3, deck: s.players.alice.don.deck - 3 });
    const after = applyIntent(realDb, s, { type: "activateMain", player: "alice", iid, effectIndex: activateIndex(ENEL_060) }).state;
    expect(after.pendingChoice?.kind).not.toBe("payDon");
    expect(after.players.alice.don.rested).toBe(2);
  });

  it("leader: the rested DON!! may be given in part, or not at all", () => {
    let s = newGame();
    s = applyIntent(realDb, s, { type: "endTurn", player: "alice" }).state;
    s = applyIntent(realDb, s, { type: "endTurn", player: "bob" }).state;
    const target = onField(s, FILLER);
    const leader = s.players.alice.leaderIid;
    s = applyIntent(realDb, s, { type: "activateMain", player: "alice", iid: leader, effectIndex: activateIndex(ENEL_LEADER) }).state;
    const seen: string[] = [];
    // add as many as the 6-card DON!! deck allows (1 active, then 2 rested), give only 1
    for (let n = 0; n < 6 && s.pendingChoice; n++) {
      const pc = s.pendingChoice;
      seen.push(pc.kind === "chooseNumber" ? `number ${pc.min}-${pc.max} ${pc.purpose}` : pc.kind === "chooseOption" ? `option ${pc.options.join(" | ")}` : pc.kind);
      if (pc.kind === "chooseNumber") s = applyIntent(realDb, s, { type: "respondNumber", player: "alice", value: pc.max }).state;
      else if (pc.kind === "chooseOption") s = applyIntent(realDb, s, { type: "respondOption", player: "alice", index: pc.options.findIndex((o) => o.includes("Give 1")) }).state;
      else if (pc.kind === "selectTargets") s = applyIntent(realDb, s, { type: "respondTargets", player: "alice", iids: [target] }).state;
      else break;
    }
    expect(seen.some((x) => x.startsWith("option") && x.includes("Give no DON!!"))).toBe(true);
    expect(s.players.alice.don.given[target]).toBe(1);
    expect(s.players.alice.don.rested).toBe(1); // the other rested DON!! stays in the cost area
  });
});
