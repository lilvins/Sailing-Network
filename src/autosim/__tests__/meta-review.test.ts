import { describe, expect, it } from "vitest";
import type { Effect } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { PlayerIntent as Intent } from "../engine/intents";
import { canPayCost } from "../engine/effects";
import { legalMoves } from "../engine/legality";
import { markStateEdited } from "../engine/stateVersion";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * Meta-deck cards checked against their printed text (ROADMAP_META_AI tappa 8,
 * review of 2026-11-10). Each test plays the card's real compiled effects.
 */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, o: Partial<EngineCard> = {}, effects?: Effect[]): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    ...(effects ? { compiled: { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } } : {}),
  } as EngineCard;
}
function addReal(id: string, o: Partial<EngineCard> = {}): void {
  addCard(id, { compiled: getGeneratedCard(id)!, ...o });
}
addCard("L", { category: "Leader", cost: 5, power: 5000 });
addReal("OP13-001", { category: "Leader", cost: 5, power: 5000, name: "Monkey.D.Luffy", types: ["Supernovas", "Straw Hat Crew"] });
addCard("FILLER");
// [Activate: Main] K.O. all of your opponent's Characters.
addCard("KO-ALL", {}, [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: { owner: "opponent", zone: "characterArea", count: 99, chooser: "controller" } }] }]);
addReal("OP15-009", { cost: 1, power: 2000, types: ["East Blue", "Navy"] });
addReal("OP06-115", { category: "Event", cost: 1, types: ["Sky Island"] });
addReal("OP04-016", { category: "Event", cost: 1 });
addReal("OP14-103", { cost: 2, power: 0, types: ["Amazon Lily"] });
// [Trigger] Play this card.
addCard("TRIGGER-STAGE", { category: "Stage" }, [{ timing: "trigger", actions: [{ kind: "playFromZone", zone: "hand", free: true, sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" } }] }]);
for (let n = 1; n <= 12; n++) addCard(`FILLER-${n}`); // pads the deck to 50 at 4 copies each

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = Object.keys(CARDS).filter((id) => CARDS[id].category !== "Leader").flatMap((id) => Array<string>(4).fill(id)).slice(0, 50);

function newGame(leader = "L"): AutoGameState {
  const config: GameConfig = { seed: "meta-review", firstPlayer: "alice", players: [{ id: "alice", leader, deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  s.turn = 3; // alice's 2nd turn: attacks are legal
  return s;
}
const go = (s: AutoGameState, i: Intent) => applyIntent(db, s, i).state;
/** Moves one copy of a card from a player's deck or hand to a zone and returns it. */
function put(s: AutoGameState, cardId: string, zone: "characterArea" | "hand" | "life" | "trash", pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); markStateEdited(s); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
/** Empties one of alice's zones into her deck. */
function clear(s: AutoGameState, zone: "hand" | "life"): void {
  const p = s.players.alice;
  p.zones.deck.push(...p.zones[zone].splice(0));
  markStateEdited(s);
}
function setDon(s: AutoGameState, pid: PID, active: number, given: Record<string, number> = {}): void {
  const d = s.players[pid].don;
  const onCards = Object.values(given).reduce((a, b) => a + b, 0);
  d.deck = 10 - active - onCards; d.active = active; d.rested = 0; d.given = given;
  markStateEdited(s);
}
/** bob's turn starts and bob's Leader attacks alice's Leader. */
function bobAttacksAlice(s: AutoGameState): AutoGameState {
  s = go(s, { type: "endTurn", player: "alice" });
  return go(s, { type: "attack", player: "bob", attackerIid: s.players.bob.leaderIid, targetIid: s.players.alice.leaderIid });
}
/** alice neither blocks nor counters: the attack reaches the damage step. */
function letItHit(s: AutoGameState): AutoGameState {
  if (s.pendingChoice?.kind === "blockWindow") s = go(s, { type: "respondBlock", player: "alice", blockerIid: null });
  if (s.pendingChoice?.kind === "counterWindow") s = go(s, { type: "passCounter", player: "alice" });
  return s;
}

describe("meta cards follow the printed text (tappa 8)", () => {
  it("OP13-001 Luffy: +2000 for every DON!! rested, nothing with no active DON!!", () => {
    let s = newGame("OP13-001");
    const leader = s.players.alice.leaderIid;
    setDon(s, "alice", 2, { [leader]: 1 });
    s = bobAttacksAlice(s);
    expect(s.pendingChoice).toMatchObject({ kind: "chooseNumber", player: "alice", max: 2 });
    s = go(s, { type: "respondNumber", player: "alice", value: 2 });
    s = go(s, { type: "respondTargets", player: "alice", iids: [leader] });
    expect(effectivePower(db, s, "alice", leader)).toBe(9000);

    let t = newGame("OP13-001");
    setDon(t, "alice", 0, { [leader]: 1 });
    t = bobAttacksAlice(t);
    expect(t.pendingChoice?.kind).not.toBe("selectTargets"); // no bonus to hand out: no target asked
    expect(effectivePower(db, t, "alice", leader)).toBe(5000);
  });


  it("OP15-009 Koby: a Character that would be removed stays, the Leader takes −2000", () => {
    let s = newGame();
    const koby = put(s, "OP15-009", "characterArea", "bob");
    const fx = getGeneratedCard("OP15-009")!.effects[0];
    expect(canPayCost(db, s, "bob", koby, fx.cost)).toBe(true);

    s = go(s, { type: "activateMain", player: "alice", iid: put(s, "KO-ALL", "characterArea"), effectIndex: 0 });
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob", sourceIid: koby, targetIid: koby });
    s = go(s, { type: "respondReplace", player: "bob", use: true });
    expect(s.players.bob.zones.characterArea).toContain(koby);
    expect(effectivePower(db, s, "bob", s.players.bob.leaderIid)).toBe(3000);
  });

  it("OP06-115: \"[Trigger] If you have 0 Life cards\" counts the Life left once the card is revealed", () => {
    let s = newGame();
    clear(s, "life");
    put(s, "OP06-115", "life");
    s = letItHit(bobAttacksAlice(s));
    expect(s.pendingChoice).toMatchObject({ kind: "triggerDecision", player: "alice" }); // it was the last Life card

    let t = newGame();
    put(t, "OP06-115", "life"); // on top of the 5 starting Life cards
    t = letItHit(bobAttacksAlice(t));
    expect(t.pendingChoice?.kind).not.toBe("triggerDecision"); // 5 Life cards left
  });

  it("OP04-016: the [Counter] needs another card in hand to trash", () => {
    const atCounter = (extraCard: boolean) => {
      let s = newGame();
      clear(s, "hand");
      const ev = put(s, "OP04-016", "hand");
      if (extraCard) put(s, "FILLER", "hand");
      setDon(s, "alice", 3);
      s = bobAttacksAlice(s);
      if (s.pendingChoice?.kind === "blockWindow") s = go(s, { type: "respondBlock", player: "alice", blockerIid: null });
      expect(s.pendingChoice).toMatchObject({ kind: "counterWindow" });
      return { s, ev };
    };
    const alone = atCounter(false);
    expect(legalMoves(db, alone.s).counterEvents).toEqual([]);
    expect(() => applyIntent(db, alone.s, { type: "useCounterEvent", player: "alice", cardIid: alone.ev })).toThrow(/activation cost/);

    const two = atCounter(true);
    expect(legalMoves(db, two.s).counterEvents.map((c) => c.iid)).toEqual([two.ev]);
    const leader = two.s.players.alice.leaderIid;
    let s = go(two.s, { type: "useCounterEvent", player: "alice", cardIid: two.ev });
    if (s.pendingChoice?.kind === "selectTargets") s = go(s, { type: "respondTargets", player: "alice", iids: [leader] });
    expect(s.players.alice.zones.hand).toEqual([]); // the other card paid the cost
    expect(effectivePower(db, s, "alice", leader)).toBe(8000);
  });

  it("OP14-103 Gloriosa: \"[Trigger] Play this card\" is a play — her [On Play] is offered", () => {
    let s = newGame();
    const gloriosa = put(s, "OP14-103", "life");
    s = letItHit(bobAttacksAlice(s));
    expect(s.pendingChoice).toMatchObject({ kind: "triggerDecision", iid: gloriosa });
    s = go(s, { type: "respondTrigger", player: "alice", activate: true });
    expect(s.players.alice.zones.characterArea).toContain(gloriosa);
    expect(s.pendingChoice).toMatchObject({ kind: "mayActivate", player: "alice", sourceIid: gloriosa });
  });

  it("\"[Trigger] Play this card\" with 5 Characters: one is trashed by rule to make room (3-7-6-1)", () => {
    let s = newGame();
    const five = [1, 2, 3, 4, 5].map((n) => put(s, `FILLER-${n}`, "characterArea"));
    const gloriosa = put(s, "OP14-103", "life");
    s = letItHit(bobAttacksAlice(s));
    s = go(s, { type: "respondTrigger", player: "alice", activate: true });
    expect(s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "alice", actionKind: "trashTarget", count: 1 });
    s = go(s, { type: "respondTargets", player: "alice", iids: [five[0]] });
    expect(s.players.alice.zones.characterArea).toContain(gloriosa);
    expect(s.players.alice.zones.characterArea).toHaveLength(5);
    expect(s.players.alice.zones.trash).toContain(five[0]);
  });

  it("\"[Trigger] Play this card\" on a Stage puts it in the Stage area, the old Stage is trashed", () => {
    let s = newGame();
    const old = put(s, "TRIGGER-STAGE", "characterArea");
    s.players.alice.zones.stage.push(s.players.alice.zones.characterArea.pop()!);
    const stage = put(s, "TRIGGER-STAGE", "life");
    s = letItHit(bobAttacksAlice(s));
    s = go(s, { type: "respondTrigger", player: "alice", activate: true });
    expect(s.players.alice.zones.stage).toEqual([stage]);
    expect(s.players.alice.zones.trash).toContain(old);
  });
});
