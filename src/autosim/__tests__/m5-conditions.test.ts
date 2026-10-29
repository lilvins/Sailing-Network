import { describe, expect, it } from "vitest";
import type { Condition, Selector, SelectorFilter } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { conditionsMet, matchesFilter } from "../engine/effects";
import type { AutoGameState, CardDb, EngineCard, PID } from "../engine/state";
import { extraCondition } from "../compiler/extraConditions";
import { conditionOf } from "../compiler/conditions";
import type { AbilityCtx } from "../compiler/types";

/**
 * M5 conditions + filters: `compare`, `anyOf`, `selfMatches`,
 * `ownTurnAtLeast`, and the filter fields that read printed values
 * (base cost / base power), attributes, colors, [Trigger], "played this turn".
 */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, o: Partial<EngineCard> & { cost: number }): void {
  CARDS[id] = {
    id, category: "Character", power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
  } as EngineCard;
}
addCard("L-TWO", { category: "Leader", cost: 5, power: 5000, colors: ["Red", "Green"], attributes: ["Slash"] });
addCard("C-SLASH", { cost: 3, power: 4000, attributes: ["Slash"], types: ["Navy"] });
addCard("C-TRIG", { cost: 2, power: 3000, types: ["Pirates"], compiled: {
  cardId: "C-TRIG", version: 1, confidence: 1, classification: "compiled", keywords: [],
  effects: [{ timing: "trigger", actions: [{ kind: "draw", count: 1 }] }],
} });
for (let i = 1; i <= 11; i++) addCard(`C-V${i}`, { cost: 1, power: 2000 });

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-SLASH", "C-TRIG", ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `C-V${i}`)].flatMap((id) => Array<string>(4).fill(id)).concat("C-V11", "C-V11");

function newGame(): AutoGameState {
  const config: GameConfig = {
    seed: "m5c", firstPlayer: "alice",
    players: [{ id: "alice", leader: "L-TWO", deck: DECK }, { id: "bob", leader: "L-TWO", deck: DECK }],
  };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}

function put(s: AutoGameState, pid: PID, cardId: string): string {
  const p = s.players[pid];
  for (const zone of ["deck", "hand"] as const) {
    const i = p.zones[zone].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) {
      const [iid] = p.zones[zone].splice(i, 1);
      p.zones.characterArea.push(iid);
      return iid;
    }
  }
  throw new Error(`no ${cardId} left`);
}

const met = (s: AutoGameState, c: Condition, src?: string) => conditionsMet(db, s, "alice", src ?? s.players.alice.leaderIid, [c]);
const fits = (s: AutoGameState, iid: string, f: SelectorFilter) => matchesFilter(db, s, "alice", iid, f, "none", true);

describe("M5 conditions", () => {
  it("compare: life / hand / DON between players and against a number", () => {
    const s = newGame();
    expect(met(s, { kind: "compare", left: { count: "life", who: "self" }, op: "le", right: { count: "life", who: "opponent" } })).toBe(true);
    expect(met(s, { kind: "compare", left: { count: "life", who: "self" }, op: "lt", right: { count: "life", who: "opponent" } })).toBe(false);
    s.players.alice.zones.life.pop();
    expect(met(s, { kind: "compare", left: { count: "life", who: "self" }, op: "lt", right: { count: "life", who: "opponent" } })).toBe(true);
    // "at least 3 less cards in hand": self + 3 <= opponent
    const handGap: Condition = { kind: "compare", left: { count: "hand", who: "self", plus: 3 }, op: "le", right: { count: "hand", who: "opponent" } };
    expect(met(s, handGap)).toBe(false);
    s.players.bob.zones.hand.push(...s.players.bob.zones.deck.splice(0, 3));
    expect(met(s, handGap)).toBe(true);
    // DON!! on the field = cost area + given; combined life of both players
    s.players.alice.don.active = 2;
    s.players.alice.don.given["x"] = 1;
    expect(met(s, { kind: "compare", left: { count: "donOnField", who: "self" }, op: "ge", right: 3 })).toBe(true);
    expect(met(s, { kind: "compare", left: { count: "donGiven", who: "self" }, op: "eq", right: 1 })).toBe(true);
    const lifeBoth = s.players.alice.zones.life.length + s.players.bob.zones.life.length;
    expect(met(s, { kind: "compare", left: { count: "life", who: "both" }, op: "eq", right: lifeBoth })).toBe(true);
  });

  it("anyOf holds when one branch holds", () => {
    const s = newGame();
    const no: Condition = { kind: "lifeAtMost", who: "self", count: 0 };
    const yes: Condition = { kind: "yourTurn" };
    expect(met(s, { kind: "anyOf", conditions: [no, yes] })).toBe(true);
    expect(met(s, { kind: "anyOf", conditions: [no, no] })).toBe(false);
  });

  it("selfMatches reads this card on the field; false off the field", () => {
    const s = newGame();
    const c = put(s, "alice", "C-SLASH");
    expect(met(s, { kind: "selfMatches", filter: { powerAtLeast: 4000 } }, c)).toBe(true);
    expect(met(s, { kind: "selfMatches", filter: { powerAtLeast: 5000 } }, c)).toBe(false);
    const inHand = s.players.alice.zones.hand[0];
    expect(met(s, { kind: "selfMatches", filter: {} }, inHand)).toBe(false);
  });

  it("ownTurnAtLeast counts each player's own turns (\"your second turn or later\")", () => {
    const s = newGame();
    const second: Condition = { kind: "ownTurnAtLeast", count: 2 };
    expect(s.turn).toBe(1);
    expect(met(s, second)).toBe(false);
    s.turn = 3; // alice (first player) is on her second turn
    expect(met(s, second)).toBe(true);
    expect(conditionsMet(db, s, "bob", s.players.bob.leaderIid, [second])).toBe(false); // bob only had turn 2
    s.turn = 4; // bob's second turn
    expect(conditionsMet(db, s, "bob", s.players.bob.leaderIid, [second])).toBe(true);
  });
});

describe("M5 filters", () => {
  it("printed cost / power, attributes, colors, types, [Trigger], played this turn", () => {
    const s = newGame();
    const slash = put(s, "alice", "C-SLASH");
    const trig = put(s, "alice", "C-TRIG");
    const leader = s.players.alice.leaderIid;
    expect(fits(s, slash, { baseCostAtLeast: 3, basePowerAtMost: 4000 })).toBe(true);
    expect(fits(s, slash, { baseCostAtMost: 2 })).toBe(false);
    expect(fits(s, slash, { attributes: ["Slash"] })).toBe(true);
    expect(fits(s, trig, { attributes: ["Slash"] })).toBe(false);
    expect(fits(s, leader, { colorCountAtLeast: 2 })).toBe(true);
    expect(fits(s, slash, { colorCountAtLeast: 2 })).toBe(false);
    expect(fits(s, slash, { typeExcludes: ["Navy"] })).toBe(false);
    expect(fits(s, trig, { typeExcludes: ["Navy"] })).toBe(true);
    expect(fits(s, trig, { hasTrigger: true })).toBe(true);
    expect(fits(s, slash, { hasTrigger: true })).toBe(false);
    s.players.alice.instances[slash].playedOnTurn = s.turn;
    expect(fits(s, slash, { playedThisTurn: true })).toBe(true);
    expect(fits(s, trig, { playedThisTurn: true })).toBe(false);
  });
});

describe("M5 compiler: condition keys", () => {
  const ctx = (text: string): AbilityCtx => ({
    card: { id: "X", text } as AbilityCtx["card"], ctx: { categoryTypes: {}, names: {} },
    timing: "onPlay", flipped: false, lastSel: null, approx: new Set(), depth: 1, tailText: null,
  });
  const ownerOf = (c: Condition[] | undefined): Selector["owner"] | undefined =>
    c?.[0]?.kind === "countInZone" ? c[0].sel.owner : undefined;

  it("\"there is / you have / your opponent has a Character with a cost of …\" follows the text", () => {
    expect(ownerOf(extraCondition("CostZeroExists", 1, ctx("If there is a Character with a cost of 0, draw 1 card."), {}))).toBe("any");
    expect(ownerOf(extraCondition("CostZeroExists", 1, ctx("If your opponent has a Character with a cost of 0, draw 2."), {}))).toBe("opponent");
    expect(ownerOf(extraCondition("CharacterCostXOrMore", 8, ctx("If you have a Character with a cost of 8 or more, give …"), {}))).toBe("self");
    expect(() => extraCondition("CharacterCostXOrMore", 8, ctx("no such phrase"), {})).toThrow();
  });

  it("comparisons and unknown keys", () => {
    expect(extraCondition("LessLife", true, ctx(""), {})).toEqual([
      { kind: "compare", left: { count: "life", who: "self" }, op: "lt", right: { count: "life", who: "opponent" } },
    ]);
    expect(extraCondition("TurnXOrLater", 2, ctx(""), {})).toEqual([{ kind: "ownTurnAtLeast", count: 2 }]);
    expect(extraCondition("NotARealKey", 1, ctx(""), {})).toBeUndefined();
  });

  it("under ForceOpponent a condition is read from the opponent's side", () => {
    const flipped = { ...ctx(""), flipped: true };
    expect(conditionOf("HandXOrMore", 6, flipped, "step", {})).toEqual([{ kind: "handAtLeast", who: "opponent", count: 6 }]);
    expect(() => conditionOf("YourTurn", 1, flipped, "step", {})).toThrow();
  });

  it("\"0 or N or more DON!!\" and \"your opponent has a Character with N power\"", () => {
    expect(conditionOf("DonXOrMore", 3, ctx(""), "proc", { DonXOrMore: 3, OrDonIsZero: 1 })[0].kind).toBe("anyOf");
    expect(extraCondition("OppCharPowerXOrMore", 8000, ctx(""), {})).toMatchObject([{ kind: "countInZone", sel: { owner: "opponent", filter: { powerAtLeast: 8000 } }, atLeast: 1 }]);
  });
});
