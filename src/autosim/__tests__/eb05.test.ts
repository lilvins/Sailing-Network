import { describe, expect, it } from "vitest";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { PlayerIntent as Intent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import { markStateEdited } from "../engine/stateVersion";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * EB05 cards whose optcg-ai data disagrees with the printed text, played in
 * the engine with their real compiled effects (compiler/textIr.ts).
 */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, o: Partial<EngineCard> = {}): void {
  CARDS[id] = { id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o } as EngineCard;
}
function addReal(id: string, o: Partial<EngineCard> = {}): void {
  addCard(id, { compiled: getGeneratedCard(id)!, ...o });
}
addCard("L", { category: "Leader", cost: 5, power: 5000 });
addCard("L-FISHMAN", { category: "Leader", cost: 5, power: 5000, types: ["Fish-Man"] });
addCard("L-ISLAND", { category: "Leader", cost: 5, power: 5000, types: ["Fish-Man Island"] });
addCard("L-STRAW", { category: "Leader", cost: 5, power: 5000, types: ["Straw Hat Crew"] });
addCard("BW", { types: ["Baroque Works"] });
addCard("BM-2000", { types: ["Big Mom Pirates"], power: 2000 });
addCard("BM-4000", { types: ["Big Mom Pirates"], power: 4000 });
addCard("BIG", { power: 7000 });
addReal("EB05-006", { cost: 2, power: 2000 });
addReal("EB05-008", { category: "Event", cost: 1, colors: ["Red"] });
addCard("RED-EVENT", { category: "Event", cost: 1, colors: ["Red"] });
addReal("EB05-017", { power: 0 });
addReal("EB05-033", { power: 2000 });
addReal("EB05-034", { cost: 2, power: 0 });
addReal("EB05-046", { cost: 4, power: 5000 });
addReal("EB05-048", { category: "Event", cost: 1 });
addReal("EB05-053", { cost: 4, power: 5000 });
addReal("EB05-054", { cost: 3, power: 4000 });
addReal("EB05-059", { category: "Event", cost: 1 });

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = Object.keys(CARDS).filter((id) => !id.startsWith("L")).flatMap((id) => Array<string>(4).fill(id)).slice(0, 50);

function newGame(leader = "L"): AutoGameState {
  const config: GameConfig = { seed: "eb05", firstPlayer: "alice", players: [{ id: "alice", leader, deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  s.turn = 3; // alice's 2nd turn: attacks are legal
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "hand" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); markStateEdited(s); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const go = (s: AutoGameState, i: Intent) => applyIntent(db, s, i).state;
function setDon(s: AutoGameState, pid: PID, active: number): void {
  const d = s.players[pid].don;
  d.deck = 10 - active; d.active = active; d.rested = 0; d.given = {};
  markStateEdited(s);
}
/** bob's turn starts and bob's Leader attacks alice's Leader. */
function bobAttacksAlice(s: AutoGameState): AutoGameState {
  s = go(s, { type: "endTurn", player: "alice" });
  return go(s, { type: "attack", player: "bob", attackerIid: s.players.bob.leaderIid, targetIid: s.players.alice.leaderIid });
}
function pickAll(s: AutoGameState, player: PID, iids?: string[]): AutoGameState {
  if (s.pendingChoice?.kind !== "selectTargets") throw new Error(`expected selectTargets, got ${s.pendingChoice?.kind}`);
  return go(s, { type: "respondTargets", player, iids: iids ?? s.pendingChoice.candidates.map((c) => c.iid) });
}

describe("EB05 cards follow the printed text", () => {
  it("EB05-017 helps a {Fish-Man} Leader, not one that is only {Fish-Man Island}", () => {
    let s = newGame("L-FISHMAN");
    put(s, "EB05-017");
    setDon(s, "alice", 1);
    s = bobAttacksAlice(s);
    expect(s.pendingChoice).toMatchObject({ kind: "mayActivate", player: "alice" });
    s = go(s, { type: "respondMay", player: "alice", activate: true });
    expect(effectivePower(db, s, "alice", s.players.alice.leaderIid)).toBe(9000);

    let t = newGame("L-ISLAND");
    put(t, "EB05-017");
    setDon(t, "alice", 1);
    t = bobAttacksAlice(t);
    if (t.pendingChoice?.kind === "mayActivate") t = go(t, { type: "respondMay", player: "alice", activate: true });
    expect(effectivePower(db, t, "alice", t.players.alice.leaderIid)).toBe(5000);
  });

  it("EB05-048 rests 1 more DON!! on top of its cost", () => {
    let s = newGame();
    const ev = put(s, "EB05-048", "alice", "hand");
    put(s, "BW");
    setDon(s, "alice", 2);
    s = go(s, { type: "playCard", player: "alice", iid: ev });
    if (s.pendingChoice?.kind === "mayActivate") s = go(s, { type: "respondMay", player: "alice", activate: true });
    if (s.pendingChoice?.kind === "selectTargets") s = pickAll(s, "alice");
    expect(s.players.alice.don.active).toBe(0);
    expect(s.players.alice.don.rested).toBe(2);
  });

  it("EB05-034 counts 7 DON!! after paying DON!! −2", () => {
    const play = (don: number) => {
      let s = newGame();
      const c = put(s, "EB05-034", "alice", "hand");
      const target = put(s, "BIG", "bob");
      setDon(s, "alice", don);
      s = go(s, { type: "playCard", player: "alice", iid: c });
      s = go(s, { type: "respondMay", player: "alice", activate: true });
      if (s.pendingChoice?.kind === "payDon") s = go(s, { type: "respondPayDon", player: "alice", fromActive: 2, fromRested: 0, fromGiven: {} });
      if (s.pendingChoice?.kind === "selectTargets") s = pickAll(s, "alice", [target]);
      return effectivePower(db, s, "bob", target);
    };
    // the Character costs 2, but DON!! rested to play it stay on the field
    expect(play(9)).toBe(3000);
    expect(play(8)).toBe(7000);
  });

  it("EB05-046 counts 10 trash cards after trashing its cost", () => {
    const attack = (inTrash: number) => {
      let s = newGame();
      put(s, "EB05-046");
      const p = s.players.alice;
      p.zones.trash.push(...p.zones.deck.splice(0, inTrash));
      markStateEdited(s);
      s = bobAttacksAlice(s);
      s = go(s, { type: "respondMay", player: "alice", activate: true });
      if (s.pendingChoice?.kind === "selectTargets") s = go(s, { type: "respondTargets", player: "alice", iids: [s.pendingChoice.candidates[0].iid] });
      return effectivePower(db, s, "alice", s.players.alice.leaderIid);
    };
    expect(attack(9)).toBe(7000);
    expect(attack(8)).toBe(5000);
  });

  it("EB05-054's [Trigger] plays exactly 4000 power: EB05-059's too", () => {
    for (const id of ["EB05-054", "EB05-059"]) {
      const trigger = getGeneratedCard(id)!.effects.find((fx) => fx.timing === "trigger")!;
      const play = trigger.actions.find((a) => a.kind === "playFromZone");
      expect(play).toMatchObject({ sel: { filter: { powerAtLeast: 4000, powerAtMost: 4000 } } });
    }
  });

  it("EB05-006 pays from the top of the Life cards only", () => {
    let s = newGame();
    const c = put(s, "EB05-006");
    const life = s.players.alice.zones.life;
    const top = life[life.length - 1]; // the top of the Life cards is the end of the array
    const lifeBefore = s.players.alice.zones.life.length;
    s = go(s, { type: "activateMain", player: "alice", iid: c, effectIndex: 0 });
    if (s.pendingChoice?.kind === "mayActivate") s = go(s, { type: "respondMay", player: "alice", activate: true });
    expect(s.pendingChoice).toMatchObject({ kind: "chooseOption" });
    expect(s.players.alice.zones.life.length).toBe(lifeBefore - 1);
    expect(s.players.alice.zones.hand).toContain(top);
  });

  it("EB05-008 gives its DON!! as a cost, before the −7000", () => {
    const main = getGeneratedCard("EB05-008")!.effects[0];
    expect(main.actions.map((a) => a.kind)).toEqual(["powerMod"]);
    expect(main.cost?.[0]).toMatchObject({ kind: "action", action: { kind: "giveActiveDon", count: 1 } });
  });

  // The Event's own DON!! and the Event itself cannot pay its [Main] cost too.
  it.each(["EB05-048", "EB05-008"])("%s cannot be played with no DON!! left for its extra cost", (id) => {
    const s = newGame();
    const ev = put(s, id, "alice", "hand");
    put(s, "BW");
    put(s, "RED-EVENT", "alice", "hand");
    put(s, "RED-EVENT", "alice", "hand");
    setDon(s, "alice", 1);
    expect(legalMoves(db, s).playableFromHand.map((x) => x.iid)).not.toContain(ev);
    expect(() => applyIntent(db, s, { type: "playCard", player: "alice", iid: ev })).toThrow(/activation cost/);
  });

  it("EB05-008 cannot reveal itself as one of the 2 red Events", () => {
    const s = newGame();
    const ev = put(s, "EB05-008", "alice", "hand");
    const p = s.players.alice;
    p.zones.deck.push(...p.zones.hand.filter((iid) => iid !== ev));
    p.zones.hand = [ev];
    put(s, "RED-EVENT", "alice", "hand");
    setDon(s, "alice", 2);
    expect(() => applyIntent(db, s, { type: "playCard", player: "alice", iid: ev })).toThrow(/activation cost/);
  });

  it("EB05-033 adds up to 4 DON!!: the player picks how many", () => {
    let s = newGame("L-STRAW");
    const c = put(s, "EB05-033", "alice", "hand");
    setDon(s, "alice", 1);
    s.players.bob.don.active = 7;
    markStateEdited(s);
    s = go(s, { type: "playCard", player: "alice", iid: c });
    expect(s.pendingChoice).toMatchObject({ kind: "selectTargets" });
    if (s.pendingChoice?.kind === "selectTargets") s = pickAll(s, "alice", s.pendingChoice.candidates.slice(0, 2).map((x) => x.iid));
    expect(s.pendingChoice).toMatchObject({ kind: "chooseOption" });
    const before = s.players.alice.don.rested;
    s = go(s, { type: "respondOption", player: "alice", index: 2 });
    expect(s.players.alice.don.rested).toBe(before + 2);
  });

  it("EB05-053's \"up to 1\" lets the player keep the card", () => {
    const whenAttacking = getGeneratedCard("EB05-053")!.effects.find((fx) => fx.timing === "whenAttacking")!;
    expect(whenAttacking.actions[0]).toMatchObject({ kind: "addToLife", sel: { zone: "hand", upTo: true } });
  });
});

describe("3-7-6-1: a Character played by an effect into a full area", () => {
  it("EB05-001 Bonney: trash 1 by rule for each Character she plays", () => {
    addReal("EB05-001", { cost: 5, power: 7000 });
    addCard("SMALL", { power: 2000 });
    addCard("L-NOVA", { category: "Leader", cost: 5, power: 5000, types: ["Supernovas"] });
    const small = (s: AutoGameState, n: number) => {
      const p = s.players.alice;
      return Array.from({ length: n }, (_, i) => {
        const iid = `alice-small-${i}`;
        p.instances[iid] = { ...p.instances[p.zones.deck[0]], cardId: "SMALL" };
        return iid;
      });
    };
    let s = newGame("L-NOVA");
    const p = s.players.alice;
    const field = small(s, 5);
    p.zones.characterArea = field;
    const bonneyIid = "alice-bonney";
    p.instances[bonneyIid] = { ...p.instances[p.zones.deck[0]], cardId: "EB05-001" };
    const inHand = ["alice-hand-a", "alice-hand-b"];
    for (const iid of inHand) p.instances[iid] = { ...p.instances[p.zones.deck[0]], cardId: "SMALL" };
    p.zones.hand = [bonneyIid, ...inHand];
    setDon(s, "alice", 5);
    s = go(s, { type: "playCard", player: "alice", iid: bonneyIid, replaceIid: field[0] });
    expect(s.players.alice.zones.characterArea).toHaveLength(5);

    for (const [i, play] of inHand.entries()) {
      s = pickAll(s, "alice", [play]); // up to 1 from the hand
      expect(s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "alice", actionKind: "trashTarget", count: 1, upTo: false });
      s = pickAll(s, "alice", [field[i + 1]]); // which one leaves by rule
      expect(s.players.alice.zones.characterArea).toContain(play);
      expect(s.players.alice.zones.trash).toContain(field[i + 1]);
      expect(s.players.alice.zones.characterArea).toHaveLength(5);
    }
    expect(s.pendingChoice).toBeNull();
  });
});
