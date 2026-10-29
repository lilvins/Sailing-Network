import { describe, expect, it } from "vitest";
import type { Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { effectiveCost, effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 long tail: alternative targets ("Characters with a cost of 0 or Stages
 * with a cost of 3 or less"), shuffles, "return 1 or more DON!!:", a ③ cost
 * written inside the payoff, "trash this Stage".
 */

const CARDS: Record<string, EngineCard> = {};
const sel = (owner: Selector["owner"], zone: Selector["zone"], count: number, extra: Partial<Selector> = {}): Selector =>
  ({ owner, zone, count, chooser: "controller", ...extra });
function addCard(id: string, effects: Effect[] | null, o: Partial<EngineCard> = {}): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    compiled: effects ? { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } : undefined,
  } as EngineCard;
}
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-KO-OR", [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: sel("opponent", "characterOrStage", 1, {
  upTo: true, filter: { costAtMost: 0, category: ["Character"], or: { costAtMost: 3, category: ["Stage"] } } }) }] }]);
addCard("C-MULL", [{ timing: "activateMain", actions: [{ kind: "shuffleHandIntoDeck", who: "self", redraw: true }] }]);
addCard("S-3", null, { category: "Stage", cost: 3 });
// [Activate: Main] Select up to 1 of your opponent's Characters. This Character's base power becomes the same as its power.
addCard("C-MATCH", [{ timing: "activateMain", actions: [
  { kind: "select", sel: sel("opponent", "characterArea", 1, { upTo: true }) },
  { kind: "setBasePower", sel: sel("self", "characterArea", 1, { self: true }), amount: 0, duration: "thisTurn", amountFromPrev: true }] }]);
// [Activate: Main] You cannot add Life cards to your hand using your own effects during this turn. Then, add 1 Life card to your hand.
addCard("C-LOCK", [{ timing: "activateMain", actions: [
  { kind: "restriction", what: "cannotTakeLifeByOwnEffects", duration: "thisTurn", sel: sel("self", "leader", 1) },
  { kind: "lifeToHand", who: "self", count: 1 }] }]);
addCard("C-3", null, { cost: 3 });
for (let i = 1; i <= 10; i++) addCard(`V${i}`, null);
for (let i = 1; i <= 6; i++) addCard(`F${i}`, null);

// [Activate: Main] Choose a cost and reveal the top card of your opponent's deck. If it has the chosen cost, draw 2 cards.
addCard("C-DECL", [{ timing: "activateMain", actions: [{ kind: "declareCost" },
  { kind: "peekDeck", who: "opponent", count: 1, then: { rest: "topAnyOrder", reveal: true } },
  { kind: "ifThen", if: [{ kind: "deckTopCostDeclared", who: "opponent" }], then: [{ kind: "draw", count: 2 }] }] }]);
addCard("E-DRAW", [{ timing: "main", actions: [{ kind: "draw", count: 2 }] }], { category: "Event", cost: 2 });
// [On Play]-like: Activate up to 1 Event from your hand.
addCard("C-ACT", [{ timing: "activateMain", actions: [{ kind: "activateEvent", sel: sel("self", "hand", 1, { upTo: true, filter: { category: ["Event"] } }) }, { kind: "draw", count: 1 }] }]);
addCard("C-ARR", [{ timing: "activateMain", actions: [{ kind: "arrangeLife", who: "self", toDeckTop: 1 }] }]);
addCard("C-XTRA", [{ timing: "activateMain", actions: [{ kind: "takeExtraTurn" }] }]);
addCard("C-DISC", [{ timing: "activateMain", actions: [{ kind: "nextPlayDiscount", filter: { nameIncludes: ["C-3"], baseCostAtLeast: 3 }, amount: 2 }] }]);
addCard("C-ANYDON", [{ timing: "activateMain", actions: [{ kind: "restDon", who: "self", count: 99, upTo: true },
  { kind: "powerMod", sel: sel("self", "leader", 1), amount: 1000, duration: "thisTurn", perPrevTarget: true },
  { kind: "trashLife", who: "self", count: 0, untilLeft: 1 }] }]);
addCard("C-LIFEPLAY", [{ timing: "activateMain", actions: [{ kind: "reveal", sel: sel("self", "lifeTop", 1) },
  { kind: "playFromZone", zone: "life", free: true, sel: sel("self", "lifeTop", 1, { upTo: true, filter: { costAtLeast: 3 } }) },
  { kind: "freezeDon", who: "opponent", count: 2 }] }]);
addCard("C-MOVEDON", [{ timing: "activateMain", actions: [
  { kind: "select", sel: sel("self", "leaderOrCharacter", 2, { upTo: true, filter: { donGivenAtLeast: 1 } }) },
  { kind: "moveGivenDon", sel: sel("self", "characterArea", 1, { filter: { nameIncludes: ["C-3"] } }), count: 2 },
  { kind: "powerMod", sel: sel("opponent", "leader", 1), amount: 0, toZero: true, duration: "thisTurn" }] }]);
addCard("C-KEEP5", [{ timing: "activateMain", actions: [{ kind: "discard", who: "opponent", sel: sel("opponent", "hand", 99, { chooser: "opponent" }), keepInHand: 2 }] }]);
addCard("C-SWAP", [{ timing: "activateMain", actions: [{ kind: "swapBasePower", sel: sel("self", "characterArea", 2), duration: "thisTurn" }] }], { power: 5000 });
const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-KO-OR", "C-MULL", "S-3", "C-3", "C-MATCH", "C-LOCK", "C-DECL", "E-DRAW", "C-ACT", "C-ARR", "C-XTRA", "C-DISC", "C-ANYDON", "C-LIFEPLAY", "C-MOVEDON", "C-KEEP5", "C-SWAP"]
  .flatMap((id) => Array<string>(3).fill(id)).slice(0, 50);
function newGame(): AutoGameState {
  const config: GameConfig = { seed: "m5tail", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "stage" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const act = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;

describe("M5 long tail (engine)", () => {
  it("alternative target: the cost-3 Stage can be K.O.'d, the cost-3 Character can't", () => {
    let s = newGame();
    const stage = put(s, "S-3", "bob", "stage");
    put(s, "C-3", "bob");
    s = act(s, put(s, "C-KO-OR"));
    if (s.pendingChoice?.kind === "selectTargets") {
      expect(s.pendingChoice.candidates.map((c) => c.iid)).toEqual([stage]);
      s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [stage] }).state;
    }
    expect(s.players.bob.zones.trash).toContain(stage);
  });

  it("return the hand to the deck, shuffle, draw as many", () => {
    let s = newGame();
    const mull = put(s, "C-MULL");
    const before = [...s.players.alice.zones.hand];
    const total = before.length + s.players.alice.zones.deck.length;
    s = act(s, mull);
    expect(s.players.alice.zones.hand.length).toBe(before.length);
    expect(s.players.alice.zones.hand.length + s.players.alice.zones.deck.length).toBe(total);
  });
});

describe("M5 long tail (engine, 2)", () => {
  it("base power becomes the selected Character's power", () => {
    let s = newGame();
    const big = put(s, "C-3", "bob");
    s.players.bob.instances[big] = { ...s.players.bob.instances[big] };
    CARDS["C-3"] = { ...CARDS["C-3"], power: 7000 };
    const me = put(s, "C-MATCH");
    s = act(s, me);
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [big] }).state;
    expect(effectivePower(db, s, "alice", me)).toBe(7000);
    CARDS["C-3"] = { ...CARDS["C-3"], power: 2000 };
  });
  it("\"you cannot add Life cards to your hand using your own effects\"", () => {
    let s = newGame();
    const life = s.players.alice.zones.life.length;
    s = act(s, put(s, "C-LOCK"));
    expect(s.players.alice.zones.life.length).toBe(life);
  });
});

describe("M5 long tail (engine, 3)", () => {
  it("\"Choose a cost and reveal …\": the right guess draws, a wrong one doesn't", () => {
    for (const [guess, drawn] of [[3, 2], [4, 0]] as const) {
      let s = newGame();
      const bob = s.players.bob;
      const c3 = bob.zones.deck.find((iid) => bob.instances[iid].cardId === "C-3")!;
      bob.zones.deck = [c3, ...bob.zones.deck.filter((x) => x !== c3)];
      const hand = s.players.alice.zones.hand.length;
      s = act(s, put(s, "C-DECL"));
      expect(s.pendingChoice).toMatchObject({ kind: "chooseNumber", purpose: "declare", max: 10 });
      s = applyIntent(db, s, { type: "respondNumber", player: "alice", value: guess }).state;
      expect(s.players.alice.zones.hand.length - hand).toBe(drawn);
      expect(s.players.bob.zones.deck[0]).toBe(c3);
    }
  });
});

describe("M5 long tail (engine, 4)", () => {
  it("activates an Event's [Main] from the hand, then goes on", () => {
    let s = newGame();
    const p = s.players.alice;
    const ev = p.zones.deck.find((iid) => p.instances[iid].cardId === "E-DRAW")!;
    p.zones.deck = p.zones.deck.filter((x) => x !== ev);
    p.zones.hand.push(ev);
    const hand = p.zones.hand.length;
    s = act(s, put(s, "C-ACT"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [ev] }).state;
    expect(s.players.alice.zones.trash).toContain(ev);
    expect(s.players.alice.zones.hand.length).toBe(hand - 1 + 2 + 1);
  });
});

describe("M5 long tail (engine, 5)", () => {
  it("look at all of your Life: 1 to the top of the deck, the rest in a new order", () => {
    let s = newGame();
    s = act(s, put(s, "C-ARR"));
    const pc = s.pendingChoice;
    expect(pc?.kind).toBe("arrangeLife");
    if (pc?.kind !== "arrangeLife") return;
    const [first, ...rest] = pc.cards;
    expect(() => applyIntent(db, s, { type: "respondArrangeLife", player: "alice", order: pc.cards, toDeck: [] })).toThrow();
    const order = [...rest].reverse();
    s = applyIntent(db, s, { type: "respondArrangeLife", player: "alice", order, toDeck: [first] }).state;
    expect(s.players.alice.zones.deck[0]).toBe(first);
    expect([...s.players.alice.zones.life].reverse()).toEqual(order);
  });
});

describe("M5 long tail (engine, 6)", () => {
  it("\"take an extra turn after this one\"", () => {
    let s = newGame();
    s = act(s, put(s, "C-XTRA"));
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.turnPlayer).toBe("alice");
    expect(s.turn).toBe(2);
    expect(s.extraTurns).toEqual([2]);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.turnPlayer).toBe("bob");
  });
});

describe("M5 long tail (engine, 7)", () => {
  it("the next play of [C-3] costs 2 less, once", () => {
    let s = newGame();
    const p = s.players.alice;
    const c3s = p.zones.deck.filter((iid) => p.instances[iid].cardId === "C-3").slice(0, 2);
    p.zones.deck = p.zones.deck.filter((x) => !c3s.includes(x));
    p.zones.hand.push(...c3s);
    s.players.alice.don.active = 5;
    s = act(s, put(s, "C-DISC"));
    expect(effectiveCost(db, s, "alice", c3s[0])).toBe(1);
    s = applyIntent(db, s, { type: "playCard", player: "alice", iid: c3s[0] }).state;
    expect(s.players.alice.don.active).toBe(4);
    expect(effectiveCost(db, s, "alice", c3s[1])).toBe(3);
  });
  it("rest any number of DON!!: +1000 for each; Life down to 1", () => {
    let s = newGame();
    s.players.alice.don.active = 4;
    s = act(s, put(s, "C-ANYDON"));
    expect(s.pendingChoice).toMatchObject({ kind: "chooseNumber", purpose: "restDon", max: 4 });
    s = applyIntent(db, s, { type: "respondNumber", player: "alice", value: 3 }).state;
    expect(s.players.alice.don.active).toBe(1);
    expect(effectivePower(db, s, "alice", s.players.alice.leaderIid)).toBe(5000 + 3000);
    expect(s.players.alice.zones.life.length).toBe(1);
  });
});

describe("M5 long tail (engine, 8)", () => {
  it("plays the revealed top Life card; freezes 2 of the opponent's rested DON!!", () => {
    let s = newGame();
    const p = s.players.alice;
    const c3 = p.zones.deck.find((iid) => p.instances[iid].cardId === "C-3")!;
    p.zones.deck = p.zones.deck.filter((x) => x !== c3);
    p.zones.life.push(c3);
    const life = p.zones.life.length;
    s.players.bob.don.rested = 3;
    s = act(s, put(s, "C-LIFEPLAY"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [c3] }).state;
    expect(s.players.alice.zones.characterArea).toContain(c3);
    expect(s.players.alice.zones.life.length).toBe(life - 1);
    expect(s.players.bob.don.frozen).toBe(2);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state; // bob's Refresh Phase
    expect(s.players.bob.don.rested).toBe(2);
  });
});

describe("M5 long tail (engine, 9)", () => {
  it("moves given DON!! to another Character; sets a power to 0", () => {
    let s = newGame();
    const c3 = put(s, "C-3");
    const L = s.players.alice.leaderIid;
    s.players.alice.don.given[L] = 2;
    const me = put(s, "C-MOVEDON");
    s = act(s, me);
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [L] }).state;
    expect(s.players.alice.don.given[c3]).toBe(2);
    expect(s.players.alice.don.given[L]).toBeUndefined();
    expect(effectivePower(db, s, "bob", s.players.bob.leaderIid)).toBe(0);
  });
});

describe("M5 long tail (engine, 10)", () => {
  it("your opponent trashes cards from their hand until they have 2", () => {
    let s = newGame();
    const n = s.players.bob.zones.hand.length;
    s = act(s, put(s, "C-KEEP5"));
    expect(s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "bob", count: n - 2, upTo: false });
    const pc = s.pendingChoice!;
    if (pc.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "bob", iids: pc.candidates.slice(0, n - 2).map((c) => c.iid) }).state;
    expect(s.players.bob.zones.hand.length).toBe(2);
  });
});

describe("M5 long tail (engine, 11)", () => {
  it("swaps the base power of 2 Characters", () => {
    let s = newGame();
    const c3 = put(s, "C-3"); // 2000
    const me = put(s, "C-SWAP"); // 5000
    s = act(s, me);
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [c3, me] }).state;
    expect(effectivePower(db, s, "alice", c3)).toBe(5000);
    expect(effectivePower(db, s, "alice", me)).toBe(2000);
  });
});

describe("M5 compiler: long tail", () => {
  it("OP03-096: Characters with a cost of 0 or Stages with a cost of 3 or less", () => {
    const fx = getGeneratedCard("OP03-096")!.effects.find((e) => e.timing === "main")!;
    expect(fx.actions[0]).toMatchObject({ kind: "koTarget", sel: { zone: "characterOrStage", filter: { costAtMost: 0, or: { costAtMost: 3, category: ["Stage"] } } } });
  });
  it("OP04-082: \"rest your Leader or 1 [Corrida Coliseum] instead\"", () => {
    const fx = getGeneratedCard("OP04-082")!.effects.find((e) => e.timing === "replacement")!;
    expect(fx.cost).toMatchObject([{ kind: "action", action: { kind: "restTarget", sel: { zone: "leaderOrStage" } } }]);
  });
  it("ST32-001: \"rest your attribute Leader or 1 of your DON!! cards:\"", () => {
    const fx = getGeneratedCard("ST32-001")!.effects.find((e) => e.timing === "onPlay")!;
    expect(fx.cost?.[0]).toMatchObject({ kind: "oneOf", options: [[{ kind: "restDon" }], [{ kind: "action", action: { kind: "restTarget", sel: { zone: "leader" } } }]] });
  });
  it("OP09-065: \"return 1 or more DON!! cards …:\" = one option per amount", () => {
    const fx = getGeneratedCard("OP09-065")!.effects.find((e) => e.timing === "onPlay")!;
    const c = fx.cost?.[0];
    expect(c?.kind).toBe("oneOf");
    if (c?.kind === "oneOf") expect(c.options.length).toBe(10);
  });
  it("ST02-001: the ③ written in the payoff step joins the cost", () => {
    const fx = getGeneratedCard("ST02-001")!.effects[0];
    expect(fx.cost).toMatchObject([{ kind: "restDon", count: 3 }, { kind: "trashFromHand" }]);
    expect(fx.actions).toMatchObject([{ kind: "standTarget" }]);
  });
  it("OP11-098: \"Cancel / Mill\" is the \"you may\" of the cost", () => {
    const fx = getGeneratedCard("OP11-098")!.effects.find((e) => e.timing === "main")!;
    expect(fx).toMatchObject({ optional: true, cost: [{ kind: "action", action: { kind: "mill", count: 3 } }] });
  });
  it("EB04-052 / OP06-009: base power becomes your opponent's Leader's", () => {
    expect(getGeneratedCard("OP06-009")!.effects[0].actions[1]).toMatchObject({ kind: "setBasePower", amountFromPrev: true, duration: "untilStartOfYourNextTurn" });
  });
  it("ST13-004: add 1 to Life, then look at all of it; 1 to the top of the deck", () => {
    expect(getGeneratedCard("ST13-004")!.effects[0].actions[1]).toEqual({ kind: "arrangeLife", who: "self", toDeckTop: 1 });
  });
  it("OP04-048 / OP06-047: shuffle the hand into the deck; the opponent's shuffle", () => {
    expect(getGeneratedCard("OP04-048")!.effects[0].actions).toEqual([{ kind: "shuffleHandIntoDeck", who: "self", redraw: true }]);
    expect(JSON.stringify(getGeneratedCard("OP06-047")!.effects[0].actions)).toContain("{\"kind\":\"shuffleDeck\",\"who\":\"opponent\"}");
  });
});
