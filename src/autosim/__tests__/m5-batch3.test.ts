import { describe, expect, it } from "vitest";
import type { Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { legalMoves } from "../engine/legality";
import { matchesFilter } from "../engine/effects";
import { effectivePower, keywordsOf, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 long tail, batch 3: "do not become active in Refresh Phases", "Your
 * Character cards are played rested", "when you draw outside your Draw
 * Phase", "when a card is added to your hand from your Life", "you cannot
 * attack a Leader during this turn", "your opponent draws", "+1000 for every
 * 3 cards placed".
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
addCard("L-REST", [{ timing: "static", actions: [{ kind: "restriction", sel: sel("self", "leader", 1), what: "charactersPlayedRested", duration: "permanentWhileInPlay" }] }],
  { category: "Leader", cost: 5, power: 5000 });
addCard("S-FREEZE", [{ timing: "static", actions: [{ kind: "restriction", sel: sel("any", "characterArea", 99, { filter: { costAtMost: 5 } }), what: "noRefresh", duration: "permanentWhileInPlay" }] }],
  { category: "Stage", cost: 1 });
addCard("C-6", null, { cost: 6 });
addCard("C-DRAWBUFF", [{ timing: "onDrawOutsideDrawPhase", oncePerTurn: true, conditions: [{ kind: "yourTurn" }],
  actions: [{ kind: "powerMod", sel: sel("self", "characterArea", 1, { self: true }), amount: 2000, duration: "thisTurn" }] }]);
addCard("C-LIFEBUFF", [{ timing: "onLifeToHand", oncePerTurn: true, conditions: [{ kind: "yourTurn" }],
  actions: [{ kind: "powerMod", sel: sel("self", "characterArea", 1, { self: true }), amount: 2000, duration: "thisTurn" }] }]);
addCard("C-DRAW", [{ timing: "activateMain", actions: [{ kind: "draw", count: 1 }] }]);
addCard("C-LIFE", [{ timing: "activateMain", actions: [{ kind: "lifeToHand", who: "self", count: 1 }] }]);
addCard("C-NOLEAD", [{ timing: "activateMain", actions: [{ kind: "restriction", sel: sel("self", "leader", 1), what: "noLeaderAttacks", duration: "thisTurn" }] }]);
addCard("C-ODRAW", [{ timing: "activateMain", actions: [{ kind: "draw", count: 2, who: "opponent" }] }]);
addCard("C-PLACE", [{ timing: "activateMain", actions: [
  { kind: "returnToDeck", where: "bottom", sel: sel("self", "trash", 99, { upTo: true }) },
  { kind: "powerMod", sel: sel("self", "characterArea", 1, { self: true }), amount: 1000, duration: "thisTurn", perPrevTarget: true, perPrevEvery: 3 }] }]);
for (let i = 1; i <= 6; i++) addCard(`V${i}`, null);
const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["S-FREEZE", "C-6", "C-DRAWBUFF", "C-LIFEBUFF", "C-DRAW", "C-LIFE", "C-NOLEAD", "C-ODRAW", "C-PLACE", "V1", "V2", "V3", "V4", "V5", "V6"]
  .flatMap((id) => Array<string>(4).fill(id)).slice(0, 50);

function newGame(leader = "L"): AutoGameState {
  const config: GameConfig = { seed: "m5b3", firstPlayer: "alice", players: [{ id: "alice", leader, deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "stage" | "hand" | "trash" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const act = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;

describe("M5 batch 3 (engine)", () => {
  it("\"Characters with a cost of 5 or less do not become active in Refresh Phases\"", () => {
    let s = newGame();
    put(s, "S-FREEZE", "alice", "stage");
    const low = put(s, "V1", "bob");
    const high = put(s, "C-6", "bob");
    s.players.bob.instances[low] = { ...s.players.bob.instances[low], rested: true };
    s.players.bob.instances[high] = { ...s.players.bob.instances[high], rested: true };
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.players.bob.instances[low].rested).toBe(true);
    expect(s.players.bob.instances[high].rested).toBe(false);
    expect(s.players.bob.instances[s.players.bob.leaderIid].rested).toBe(false);
  });

  it("\"Your Character cards are played rested\"", () => {
    let s = newGame("L-REST");
    const c = put(s, "V2", "alice", "hand");
    s.players.alice.don.active = 5;
    s = applyIntent(db, s, { type: "playCard", player: "alice", iid: c }).state;
    expect(s.players.alice.zones.characterArea).toContain(c);
    expect(s.players.alice.instances[c].rested).toBe(true);
  });

  it("\"When you draw a card outside of your Draw Phase\" (once per turn)", () => {
    let s = newGame();
    const buff = put(s, "C-DRAWBUFF");
    const draw = put(s, "C-DRAW");
    s = act(s, draw);
    expect(effectivePower(db, s, "alice", buff)).toBe(4000);
  });

  it("\"When a card is added to your hand from your Life\"", () => {
    let s = newGame();
    const buff = put(s, "C-LIFEBUFF");
    s = act(s, put(s, "C-LIFE"));
    expect(effectivePower(db, s, "alice", buff)).toBe(4000);
  });

  it("\"you cannot attack a Leader during this turn\"", () => {
    let s = newGame();
    s.turn = 3; // alice's 2nd turn
    s = act(s, put(s, "C-NOLEAD"));
    const leader = s.players.alice.leaderIid;
    const moves = legalMoves(db, s);
    const mine = moves.attackers.find((x) => x.iid === leader);
    expect(mine?.targets ?? []).not.toContain(s.players.bob.leaderIid);
  });

  it("\"your opponent draws 2 cards\"", () => {
    let s = newGame();
    const mine = s.players.alice.zones.hand.length, theirs = s.players.bob.zones.hand.length;
    s = act(s, put(s, "C-ODRAW"));
    expect(s.players.alice.zones.hand.length).toBe(mine);
    expect(s.players.bob.zones.hand.length).toBe(theirs + 2);
  });

  it("\"+1000 power for every 3 cards placed at the bottom of your deck\"", () => {
    let s = newGame();
    const a = s.players.alice;
    a.zones.trash.push(...a.zones.deck.splice(0, 7));
    const me = put(s, "C-PLACE");
    const pile = [...s.players.alice.zones.trash];
    s = act(s, me);
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: pile.slice(0, 7) }).state;
    expect(s.players.alice.zones.trash.length).toBe(pile.length - 7);
    expect(effectivePower(db, s, "alice", me)).toBe(4000);
  });
});

describe("M5 batch 3 (compiler)", () => {
  it("OP05-040 / OP09-022 / OP05-053 / OP05-107 / OP06-026 / OP07-090 / OP07-091 / OP06-047", () => {
    expect(getGeneratedCard("OP05-040")!.effects[0].actions[0]).toMatchObject({ kind: "restriction", what: "noRefresh", sel: { owner: "any", filter: { costAtMost: 5 } } });
    expect(getGeneratedCard("OP09-022")!.effects[0].actions[0]).toMatchObject({ what: "charactersPlayedRested" });
    expect(getGeneratedCard("OP05-053")!.effects[0].timing).toBe("onDrawOutsideDrawPhase");
    expect(getGeneratedCard("OP05-107")!.effects[0].timing).toBe("onLifeToHand");
    expect(getGeneratedCard("OP06-026")!.effects[0].actions[1]).toMatchObject({ what: "noLeaderAttacks", duration: "thisTurn" });
    expect(getGeneratedCard("OP07-090")!.effects[0].actions.map((x) => x.kind)).toEqual(["discard", "reveal", "draw"]);
    expect(getGeneratedCard("OP07-090")!.effects[0].actions[2]).toMatchObject({ who: "opponent" });
    expect(getGeneratedCard("OP07-091")!.effects[0].actions[2]).toMatchObject({ kind: "powerMod", perPrevEvery: 3 });
    expect(getGeneratedCard("OP06-047")!.effects[0].actions[2]).toMatchObject({ kind: "draw", count: 5, who: "opponent" });
  });
});

describe("M5 batch 3b (compiler)", () => {
  it("OP03-043 / OP08-105 / OP05-109 / OP11-102: damage, Life removal and [Trigger] timings", () => {
    expect(getGeneratedCard("OP03-043")!.effects[0]).toMatchObject({ timing: "onYouDealDamage", optional: true });
    expect(getGeneratedCard("OP08-105")!.effects[0]).toMatchObject({ timing: "onLifeRemoved", react: { whose: "opponents" } });
    expect(getGeneratedCard("OP05-109")!.effects[0]).toMatchObject({ timing: "onTriggerActivated", react: {} });
    expect(getGeneratedCard("OP11-102")!.effects.map((f) => f.timing)).toEqual(["onOpponentActivatesEvent", "onTriggerActivated"]);
  });
});

addCard("C-OPPLIFE", [{ timing: "onLifeRemoved", react: { whose: "opponents" }, actions: [{ kind: "draw", count: 1 }] }]);
addCard("C-TRASHOPPLIFE", [{ timing: "activateMain", actions: [{ kind: "trashLife", who: "opponent", count: 1 }] }]);
addCard("C-YOUDMG", [{ timing: "onYouDealDamage", actions: [{ kind: "draw", count: 1 }] }]);
addCard("C-DMG", [{ timing: "activateMain", actions: [{ kind: "dealDamage", who: "opponent", count: 1 }] }]);
/** A Character of `cardId` on alice's field (a vanilla instance renamed). */
function putAs(s: AutoGameState, cardId: string): string {
  const iid = put(s, "V1");
  s.players.alice.instances[iid] = { ...s.players.alice.instances[iid], cardId };
  return iid;
}

describe("M5 batch 3b (engine)", () => {
  it("\"When a card is removed from your opponent's Life cards\": not your own", () => {
    let s = newGame();
    putAs(s, "C-OPPLIFE");
    const hand = s.players.alice.zones.hand.length;
    s = act(s, put(s, "C-LIFE")); // own Life → hand: no draw
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
    s = act(s, putAs(s, "C-TRASHOPPLIFE"));
    expect(s.players.alice.zones.hand.length).toBe(hand + 2);
  });

  it("\"When you deal damage to your opponent's Life\": effect damage too", () => {
    let s = newGame();
    putAs(s, "C-YOUDMG");
    const hand = s.players.alice.zones.hand.length;
    s = act(s, putAs(s, "C-DMG"));
    if (s.pendingChoice?.kind === "triggerDecision") s = applyIntent(db, s, { type: "respondTrigger", player: "bob", activate: false }).state;
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });
});

addCard("C-MILLAS", [{ timing: "activateMain", actions: [
  { kind: "discard", who: "self", sel: sel("self", "hand", 2, { upTo: true }) },
  { kind: "mill", who: "self", count: 0, countFromPrev: true }] }]);
addCard("C-MILLIF", [{ timing: "activateMain", actions: [{ kind: "mill", who: "self", count: 1 },
  { kind: "ifThen", if: [{ kind: "milledMatches", filter: { costAtLeast: 6 } }], then: [{ kind: "draw", count: 1 }] }] }]);
addCard("C-NEGKO", [{ timing: "activateMain", actions: [
  { kind: "select", sel: sel("opponent", "characterArea", 1, { upTo: true }) },
  { kind: "koTarget", sel: sel("opponent", "characterArea", 1, { prev: true, filter: { costAtMost: 4 } }) }] }]);

describe("M5 batch 3c (engine)", () => {
  it("\"Trash the same number of cards from the top of your deck as you did from your hand\"", () => {
    let s = newGame();
    const deck = s.players.alice.zones.deck.length;
    s = act(s, putAs(s, "C-MILLAS"));
    const hand = [...s.players.alice.zones.hand];
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: hand.slice(0, 1) }).state;
    expect(s.players.alice.zones.deck.length).toBe(deck - 1 - 1); // the put card + 1 milled
  });

  it("\"If the trashed card has a cost of 6 or more\"", () => {
    for (const [top, drawn] of [["C-6", 1], ["V2", 0]] as const) {
      let s = newGame();
      const me = putAs(s, "C-MILLIF");
      const a = s.players.alice;
      const t = a.zones.deck.find((iid) => a.instances[iid].cardId === top)!;
      a.zones.deck = [t, ...a.zones.deck.filter((x) => x !== t)];
      const hand = a.zones.hand.length;
      s = act(s, me);
      expect(s.players.alice.zones.hand.length - hand).toBe(drawn);
    }
  });

  it("\"if that Character has a cost of 4 or less, K.O. it\"", () => {
    for (const [id, ko] of [["V2", true], ["C-6", false]] as const) {
      let s = newGame();
      const t = put(s, id, "bob");
      s = act(s, putAs(s, "C-NEGKO"));
      if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [t] }).state;
      expect(s.players.bob.zones.trash.includes(t)).toBe(ko);
    }
  });
});

describe("M5 batch 3c (compiler)", () => {
  it("OP04-040 / OP08-057: a gated Choices step falls through when the gate fails", () => {
    const a = getGeneratedCard("OP04-040")!.effects[0];
    expect(a.conditions).toContainEqual({ kind: "compare", left: { count: "lifeAndHand", who: "self" }, op: "le", right: 4 });
    expect(a.actions[0]).toMatchObject({ kind: "ifThen", else: [{ kind: "draw", count: 1 }] });
    expect(getGeneratedCard("OP08-057")!.effects[0].actions[0]).toMatchObject({ kind: "ifThen", else: [{ kind: "costMod" }] });
  });
  it("OP02-025 / OP09-059 / OP09-098 / OP08-096 / OP10-022", () => {
    expect(getGeneratedCard("OP02-025")!.effects[0].actions[0]).toMatchObject({ kind: "nextPlayDiscount", filter: { typeIncludes: ["Land of Wano"], baseCostAtLeast: 3 }, amount: 1 });
    expect(getGeneratedCard("OP09-059")!.effects[0].actions[2]).toMatchObject({ kind: "mill", countFromPrev: true });
    expect(getGeneratedCard("OP09-098")!.effects[0].actions[1]).toMatchObject({ kind: "koTarget", sel: { prev: true, filter: { costAtMost: 4 } } });
    expect(getGeneratedCard("OP08-096")!.effects[0].actions[1]).toMatchObject({ kind: "ifThen", if: [{ kind: "milledMatches", filter: { costAtLeast: 6 } }] });
    expect(getGeneratedCard("OP10-022")!.effects[0].conditions).toContainEqual({ kind: "compare", left: { count: "charactersTotalCost", who: "self" }, op: "ge", right: 5 });
  });
});

addCard("C-NEGATE", [{ timing: "activateMain", actions: [{ kind: "negateEffect", sel: sel("opponent", "characterArea", 1), scope: "all", duration: "thisTurn" }] }]);
addCard("C-BLOCKER-STATIC", [{ timing: "static", actions: [{ kind: "powerMod", sel: sel("self", "characterArea", 1, { self: true }), amount: 3000, duration: "permanentWhileInPlay" }] }]);

describe("M5 batch 3d (engine): negate, redirect", () => {
  it("\"Negate the effect of 1 of your opponent's Characters\": its static stops, until the end of the turn", () => {
    let s = newGame();
    const t = put(s, "V2", "bob");
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: "C-BLOCKER-STATIC" };
    expect(effectivePower(db, s, "bob", t)).toBe(5000);
    s = act(s, putAs(s, "C-NEGATE"));
    expect(effectivePower(db, s, "bob", t)).toBe(2000);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(effectivePower(db, s, "bob", t)).toBe(5000);
  });
});

describe("M5 batch 3d (compiler)", () => {
  it("OP13-028: \"Set all of your DON!! as active. Then, you cannot play cards from your hand\"", () => {
    expect(getGeneratedCard("OP13-028")!.effects[0].actions).toEqual([{ kind: "standDon", count: 10 },
      { kind: "restriction", what: "cannotPlayFromHand", duration: "thisTurn", sel: { owner: "self", zone: "leader", count: 1, chooser: "controller" } }]);
  });
});

addCard("C-HANDLOCK", [{ timing: "activateMain", actions: [{ kind: "restriction", what: "cannotPlayFromHand", duration: "thisTurn", sel: sel("self", "leader", 1) }] }]);
describe("M5 batch 3d (engine): hand lock", () => {
  it("\"you cannot play cards from your hand during this turn\"", () => {
    let s = newGame();
    s.players.alice.don.active = 5;
    const c = put(s, "V2", "alice", "hand");
    s = act(s, putAs(s, "C-HANDLOCK"));
    expect(legalMoves(db, s).playableFromHand.map((x) => x.iid)).not.toContain(c);
    expect(() => applyIntent(db, s, { type: "playCard", player: "alice", iid: c })).toThrow(/cannot play/);
  });
});

addCard("C-SELFDMG", [{ timing: "activateMain", actions: [{ kind: "dealDamage", who: "self", count: 1 }] }]);
describe("M5 batch 3e (engine)", () => {
  it("\"you take 1 damage\": your top Life card goes to your hand", () => {
    let s = newGame();
    const life = s.players.alice.zones.life.length, hand = s.players.alice.zones.hand.length;
    s = act(s, putAs(s, "C-SELFDMG"));
    if (s.pendingChoice?.kind === "triggerDecision") s = applyIntent(db, s, { type: "respondTrigger", player: "alice", activate: false }).state;
    expect(s.players.alice.zones.life.length).toBe(life - 1);
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });
});

describe("M5 batch 3e (compiler)", () => {
  it("OP14-115 / P-084 / OP14-079 / OP15-024 / OP15-041", () => {
    expect(JSON.stringify(getGeneratedCard("OP14-115")!.effects[0])).toContain('{"kind":"dealDamage","who":"self","count":1}');
    expect(getGeneratedCard("P-084")!.effects[1].actions[0]).toMatchObject({ what: "cannotAttack", sel: { owner: "any", filter: { costAtLeast: 3, costAtMost: 4 } } });
    expect(getGeneratedCard("OP14-079")!.effects[0].actions[0]).toMatchObject({ what: "cannotBeRemovedByOpponent", sel: { owner: "opponent" } });
    expect(getGeneratedCard("OP15-024")!.effects[0].actions.map((a) => a.kind)).toEqual(["grantKeyword", "restriction"]);
    expect(getGeneratedCard("OP15-041")!.effects[1]).toMatchObject({ timing: "activateMain", actions: [{ kind: "grantKeyword", keyword: "Rush" }] });
  });
});

addCard("C-SILENCE", [{ timing: "static", actions: [{ kind: "negateEffect", scope: "all", duration: "permanentWhileInPlay",
  sel: sel("self", "leaderOrCharacter", 99, { filter: { typeExcludes: ["Roger Pirates"] } }) }] }], { types: ["Roger Pirates"] });
addCard("C-IFKO", [{ timing: "activateMain", conditions: [{ kind: "happenedThisTurn", who: "opponent", what: "characterKOd" }], actions: [{ kind: "draw", count: 1 }] }]);
addCard("C-KO1", [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: sel("opponent", "characterArea", 1) }] }]);

describe("M5 batch 3f (engine)", () => {
  it("\"… that do not have a type including Roger Pirates have their effects negated\" (static)", () => {
    let s = newGame();
    const buffed = putAs(s, "C-BLOCKER-STATIC");
    expect(effectivePower(db, s, "alice", buffed)).toBe(5000);
    const draw = putAs(s, "C-DRAW");
    putAs(s, "C-SILENCE");
    expect(effectivePower(db, s, "alice", buffed)).toBe(2000);
    expect(() => act(s, draw)).toThrow(/negated/);
    expect(legalMoves(db, s).activatable.map((x) => x.iid)).not.toContain(draw);
  });

  it("\"If your opponent's Character has been K.O.'d during this turn\"", () => {
    let s = newGame();
    const ifko = putAs(s, "C-IFKO");
    expect(legalMoves(db, s).activatable.map((x) => x.iid)).not.toContain(ifko);
    put(s, "V2", "bob");
    s = act(s, putAs(s, "C-KO1"));
    expect(legalMoves(db, s).activatable.map((x) => x.iid)).toContain(ifko);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.players.bob.thisTurn).toBeUndefined();
  });
});

describe("M5 batch 3f (compiler)", () => {
  it("OP13-064 / OP16-100 / ST33-004", () => {
    expect(getGeneratedCard("OP13-064")!.effects[0].actions[0]).toMatchObject({ kind: "negateEffect", sel: { zone: "leaderOrCharacter", filter: { typeExcludes: ["Former Roger Pirates", "Roger Pirates"] } } });
    expect(getGeneratedCard("OP16-100")!.effects[0].conditions).toEqual([{ kind: "happenedThisTurn", who: "opponent", what: "characterKOd" }]);
    expect(getGeneratedCard("ST33-004")!.effects[0].conditions).toEqual([{ kind: "happenedThisTurn", who: "self", what: "handTrashed" }]);
  });
});

addCard("C-HANDBOTTOM", [{ timing: "activateMain", actions: [
  { kind: "returnToDeck", where: "bottom", sel: sel("self", "hand", 99) }, { kind: "draw", count: 0, countFromPrev: true }] }]);
addCard("C-SWAPL", [{ timing: "activateMain", actions: [{ kind: "swapBasePower", sel: sel("self", "characterArea", 1, { filter: { nameIncludes: ["V2"] } }), duration: "thisTurn", withLeader: true }] }]);
addCard("C-LEADBASE", [{ timing: "static", actions: [{ kind: "setBasePower", sel: sel("self", "characterArea", 1, { self: true }), amount: 0, fromLeaderBase: true, duration: "permanentWhileInPlay" }] }]);
addCard("C-EQDON", [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: sel("opponent", "characterArea", 1, { upTo: true, filter: { costEqualsGivenDon: true } }) }] }]);

describe("M5 batch 3g (engine)", () => {
  it("\"place all cards in your hand at the bottom of your deck … draw as many\"", () => {
    let s = newGame();
    const me = putAs(s, "C-HANDBOTTOM");
    const before = [...s.players.alice.zones.hand];
    s = act(s, me);
    expect(s.players.alice.zones.hand.length).toBe(before.length);
    expect(s.players.alice.zones.deck.slice(-before.length).sort()).toEqual([...before].sort());
  });
  it("swap base power with the Leader; base power = the Leader's", () => {
    let s = newGame();
    const v2 = put(s, "V2");
    s = act(s, putAs(s, "C-SWAPL"));
    expect(effectivePower(db, s, "alice", v2)).toBe(5000);
    expect(effectivePower(db, s, "alice", s.players.alice.leaderIid)).toBe(2000);
    const lb = putAs(s, "C-LEADBASE");
    expect(effectivePower(db, s, "alice", lb)).toBe(5000);
  });
  it("\"a cost equal to the number of DON!! cards given to it\"", () => {
    let s = newGame();
    const a = put(s, "V2", "bob"), b = put(s, "V3", "bob");
    s.players.bob.don.given = { [a]: 1 };
    s = act(s, putAs(s, "C-EQDON"));
    if (s.pendingChoice?.kind === "selectTargets") {
      expect(s.pendingChoice.candidates.map((c) => c.iid)).toEqual([a]);
      s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [a] }).state;
    }
    expect(s.players.bob.zones.trash).toContain(a);
    expect(s.players.bob.zones.characterArea).toContain(b);
  });
});

describe("M5 batch 3g (compiler)", () => {
  it("P-046 / OP17-116 / ST30-016 / OP15-031 / OP13-077 / OP10-098 / OP12-096 / OP13-100 / P-058 / OP14-009 / OP14-053", () => {
    const g = (id: string) => getGeneratedCard(id)!;
    expect(g("P-046").effects[0].actions[0]).toMatchObject({ kind: "chooseOne", options: [[{ kind: "returnToDeck" }, { kind: "draw", countFromPrev: true }], []] });
    expect(g("OP17-116").effects[1].conditions?.[0]).toMatchObject({ kind: "countInZone", sel: { filter: { hasTrigger: true } }, atLeast: 2 });
    expect(JSON.stringify(g("ST30-016").effects[0])).toContain('"kind":"allOf"');
    expect(g("OP15-031").effects[0].actions[0]).toMatchObject({ sel: { filter: { costEqualsGivenDon: true, rested: true } } });
    expect(g("OP13-077").effects[0].actions.map((x) => x.kind)).toEqual(["koTarget", "koTarget"]);
    expect(g("OP10-098").effects[0].actions.map((x) => x.kind)).toEqual(["koTarget", "koTarget"]);
    expect(g("OP12-096").effects[0].actions[0]).toMatchObject({ kind: "ifThen", then: [{ sel: { filter: { costAtMost: 6 } } }], else: [{ sel: { filter: { costAtMost: 4 } } }] });
    expect(g("OP13-100").effects[0]).toMatchObject({ timing: "onYouPlayCharacter", react: { filter: { hasTrigger: true } } });
    expect(g("P-058").effects[2]).toMatchObject({ timing: "delayed", actions: [{ kind: "standTarget" }] });
    expect(g("OP14-009").effects[0].actions[0]).toMatchObject({ kind: "swapBasePower", withLeader: true, duration: "thisBattle" });
    expect(g("OP14-053").effects[0].actions[0]).toMatchObject({ kind: "setBasePower", fromLeaderBase: true });
  });
});

addCard("L-NOONPLAY", [{ timing: "static", actions: [{ kind: "restriction", sel: sel("self", "leader", 1), what: "onPlaysNegated", duration: "permanentWhileInPlay" }] }],
  { category: "Leader", cost: 5, power: 5000 });
addCard("C-OPDRAW", [{ timing: "onPlay", actions: [{ kind: "draw", count: 1 }] }]);
addCard("C-KOBATTLE", [{ timing: "onKOInBattle", actions: [{ kind: "draw", count: 1 }] }], { power: 9000 });
addCard("L-ATKLEAD", [{ timing: "whenAttacking", conditions: [{ kind: "attackingLeader" }], actions: [{ kind: "draw", count: 1 }] }],
  { category: "Leader", cost: 5, power: 5000 });

/** Run an attack to its end: no block, no counter, no [Trigger]. */
function battle(s: AutoGameState, attackerIid: string, targetIid: string): AutoGameState {
  s = applyIntent(db, s, { type: "attack", player: "alice", attackerIid, targetIid }).state;
  for (let i = 0; i < 10 && s.battle; i++) {
    const c = s.pendingChoice;
    if (c?.kind === "triggerDecision") s = applyIntent(db, s, { type: "respondTrigger", player: c.player, activate: false }).state;
    else if (s.battle.step === "block") s = applyIntent(db, s, { type: "respondBlock", player: "bob", blockerIid: null }).state;
    else if (s.battle.step === "counter") s = applyIntent(db, s, { type: "passCounter", player: "bob" }).state;
    else break;
  }
  return s;
}

describe("M5 batch 3h (engine)", () => {
  it("\"Your [On Play] effects are negated\"", () => {
    let s = newGame("L-NOONPLAY");
    s.players.alice.don.active = 5;
    const c = putAs(s, "C-OPDRAW");
    s.players.alice.zones.characterArea = s.players.alice.zones.characterArea.filter((x) => x !== c);
    s.players.alice.zones.hand.push(c);
    const hand = s.players.alice.zones.hand.length;
    s = applyIntent(db, s, { type: "playCard", player: "alice", iid: c }).state;
    expect(s.players.alice.zones.hand.length).toBe(hand - 1);
  });

  it("\"When this Character battles and K.O.'s your opponent's Character\"; \"When this Leader attacks your opponent's Leader\"", () => {
    let s = newGame("L-ATKLEAD");
    s.turn = 3;
    const me = putAs(s, "C-KOBATTLE");
    const t = put(s, "V2", "bob");
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], rested: true };
    let hand = s.players.alice.zones.hand.length;
    s = battle(s, me, t);
    expect(s.players.bob.zones.trash).toContain(t);
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
    hand = s.players.alice.zones.hand.length;
    const t2 = put(s, "V3", "bob");
    s.players.bob.instances[t2] = { ...s.players.bob.instances[t2], rested: true };
    s = battle(s, s.players.alice.leaderIid, t2); // a Character: no draw
    expect(s.players.alice.zones.hand.length).toBe(hand);
  });
});
describe("M5 batch 3h (engine, 2)", () => {
  it("\"When this Leader attacks your opponent's Leader\": draws", () => {
    let s = newGame("L-ATKLEAD");
    s.turn = 3;
    const hand = s.players.alice.zones.hand.length;
    s = battle(s, s.players.alice.leaderIid, s.players.bob.leaderIid);
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });
});
describe("M5 batch 3h (compiler)", () => {
  it("OP02-094 / OP04-086 / OP04-024 / OP12-081 / OP09-081 / OP12-036", () => {
    const g = (id: string) => getGeneratedCard(id)!;
    expect(g("OP02-094").effects[0].timing).toBe("onKOInBattle");
    expect(g("OP04-086").effects[0].timing).toBe("onKOInBattle");
    expect(g("OP04-024").effects[0]).toMatchObject({ timing: "onYouPlayCharacter", react: { whose: "opponents" } });
    expect(g("OP12-081").effects[0].conditions).toContainEqual({ kind: "attackingLeader" });
    expect(g("OP09-081").effects.map((f) => f.actions[0].kind === "restriction" && f.actions[0].what)).toEqual(["onPlaysNegated", "onPlaysNegated"]);
    expect(g("OP12-036").effects[0].actions[0]).toMatchObject({ what: "cannotBePlayedByEffects", sel: { zone: "hand", self: true } });
  });
});

addCard("C-SOT", [{ timing: "startOfYourTurn", optional: true, actions: [{ kind: "draw", count: 1 }] }]);
addCard("L-DONPHASE", [{ timing: "onDonPhase", actions: [{ kind: "giveActiveDon", sel: sel("self", "leader", 1, { self: true }), count: 1 }] }],
  { category: "Leader", cost: 5, power: 5000 });
describe("M5 batch 3i (engine): turn start", () => {
  it("\"at the start of your turn\" resolves before the Draw Phase; the DON!! Phase gift", () => {
    let s = newGame();
    const deck = s.players.bob.zones.deck.length;
    const sot = put(s, "V2", "bob");
    s.players.bob.instances[sot] = { ...s.players.bob.instances[sot], cardId: "C-SOT" };
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "mayActivate", player: "bob" });
    expect(s.players.bob.zones.deck.length).toBe(deck - 1); // only the put card left the deck: no draw yet
    s = applyIntent(db, s, { type: "respondMay", player: "bob", activate: true }).state;
    expect(s.players.bob.zones.deck.length).toBe(deck - 3); // the effect's draw + the Draw Phase
    expect(s.phase).toBe("main");
  });
  it("\"1 DON!! card placed during your DON!! Phase is given to your Leader\"", () => {
    const config: GameConfig = { seed: "m5b3", firstPlayer: "alice", players: [{ id: "alice", leader: "L-DONPHASE", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
    let s = createGame(db, config).state;
    s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
    s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
    expect(s.players.alice.don.given[s.players.alice.leaderIid]).toBe(1);
    expect(s.players.alice.don.active).toBe(0);
  });
});
addCard("C-BOUNCE", [{ timing: "activateMain", actions: [{ kind: "returnToHand", sel: sel("opponent", "characterArea", 1) }] }]);
addCard("C-ONBOUNCE", [{ timing: "onCharacterBounced", react: { by: "you", whose: "opponents", filter: { category: ["Character"] } }, actions: [{ kind: "draw", count: 1 }] }]);
describe("M5 batch 3j", () => {
  it("\"When your opponent's Character is returned to the owner's hand by your effect\"", () => {
    let s = newGame();
    putAs(s, "C-ONBOUNCE");
    put(s, "V2", "bob");
    const hand = s.players.alice.zones.hand.length;
    s = act(s, putAs(s, "C-BOUNCE"));
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });
  it("EB02-023 / EB05-010 (compiler)", () => {
    expect(getGeneratedCard("EB02-023")!.effects[0]).toMatchObject({ timing: "onCharacterBounced", react: { by: "you", whose: "opponents" } });
    expect(getGeneratedCard("EB05-010")!.effects[0]).toMatchObject({ timing: "onCharacterKOd", react: { whose: "yours", filter: { lacksKeyword: "Blocker", attributes: ["Wisdom"] } } });
  });
});

describe("M5 batch 3k: IR from the printed text", () => {
  it("OP12-016: give 2 active DON!! to [Silvers Rayleigh] → it cannot be blocked this turn", () => {
    const g = getGeneratedCard("OP12-016")!;
    CARDS["E-RAY"] = { id: "E-RAY", category: "Event", cost: 0, power: 0, counter: 0, colors: ["Red"], types: [], name: "E-RAY",
      compiled: { ...g, cardId: "E-RAY" } } as EngineCard;
    CARDS["C-RAY"] = { ...CARDS.V1, id: "C-RAY", name: "Silvers Rayleigh" } as EngineCard;
    let s = newGame();
    const ray = putAs(s, "C-RAY");
    const ev = put(s, "V2", "alice", "hand");
    s.players.alice.instances[ev] = { ...s.players.alice.instances[ev], cardId: "E-RAY" };
    s.players.alice.don.active = 3;
    s = applyIntent(db, s, { type: "playCard", player: "alice", iid: ev }).state;
    if (s.pendingChoice?.kind === "mayActivate") s = applyIntent(db, s, { type: "respondMay", player: "alice", activate: true }).state;
    expect(s.players.alice.don.given[ray]).toBe(2);
    expect([...keywordsOf(db, s, "alice", ray)]).toContain("Unblockable");
  });
  it("OP11-020 / OP11-061 / OP14-058 / OP15-095 (compiler)", () => {
    expect(getGeneratedCard("OP11-020")!.effects.map((f) => f.timing)).toEqual(["counter", "trigger"]);
    expect(getGeneratedCard("OP11-061")!.effects[1].actions[0]).toMatchObject({ kind: "returnToDeck", sel: { owner: "any" } });
    expect(getGeneratedCard("OP14-058")!.effects[0].actions[1]).toMatchObject({ kind: "returnToHand", sel: { owner: "any" } });
    expect(getGeneratedCard("OP15-095")!.effects[0].actions[0]).toMatchObject({ sel: { zone: "leaderOrCharacter" } });
  });
});

describe("M5 batch 3l: IR from the printed text (engine)", () => {
  it("EB04-011: draw one per {Neptunian}, then trash as many", () => {
    CARDS["C-NEP"] = { ...CARDS.V1, id: "C-NEP", types: ["Neptunian"] } as EngineCard;
    let s = newGame();
    putAs(s, "C-NEP"); putAs(s, "C-NEP");
    const ir = getGeneratedCard("EB04-011")!.effects[0];
    CARDS["C-EB04"] = { ...CARDS.V1, id: "C-EB04", compiled: { cardId: "C-EB04", version: 1, confidence: 1, classification: "compiled", keywords: [], effects: [{ ...ir, timing: "activateMain" }] } } as EngineCard;
    const hand = s.players.alice.zones.hand.length, trash = s.players.alice.zones.trash.length;
    s = act(s, putAs(s, "C-EB04"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: s.pendingChoice.candidates.slice(0, 2).map((c) => c.iid) }).state;
    expect(s.players.alice.zones.hand.length).toBe(hand);
    expect(s.players.alice.zones.trash.length).toBe(trash + 2);
  });

  it("OP08-118: −3000 and −2000 go to two different Characters", () => {
    const ir = getGeneratedCard("OP08-118")!.effects[0];
    CARDS["C-OP08"] = { ...CARDS.V1, id: "C-OP08", compiled: { cardId: "C-OP08", version: 1, confidence: 1, classification: "compiled", keywords: [], effects: [{ ...ir, timing: "activateMain" }] } } as EngineCard;
    CARDS["C-BIG"] = { ...CARDS.V1, id: "C-BIG", power: 9000 } as EngineCard;
    let s = newGame();
    const a = putAs(s, "C-BIG");
    s.players.alice.zones.characterArea = s.players.alice.zones.characterArea.filter((x) => x !== a);
    const x = put(s, "V2", "bob"), y = put(s, "V3", "bob");
    s.players.bob.instances[x] = { ...s.players.bob.instances[x], cardId: "C-BIG" };
    s.players.bob.instances[y] = { ...s.players.bob.instances[y], cardId: "C-BIG" };
    s = act(s, putAs(s, "C-OP08"));
    s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [x] }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "selectTargets" });
    if (s.pendingChoice?.kind === "selectTargets") {
      expect(s.pendingChoice.candidates.map((c) => c.iid)).toEqual([y]);
      s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [y] }).state;
    }
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [] }).state;
    expect(effectivePower(db, s, "bob", x)).toBe(6000);
    expect(effectivePower(db, s, "bob", y)).toBe(7000);
  });

  it("EB02-057-style: a Character of the opponent to the bottom of their Life, face-up", () => {
    const ir = getGeneratedCard("EB02-057")!.effects[0];
    CARDS["C-EB02"] = { ...CARDS.V1, id: "C-EB02", compiled: { cardId: "C-EB02", version: 1, confidence: 1, classification: "compiled", keywords: [],
      effects: [{ timing: "activateMain", actions: ir.actions }] } } as EngineCard;
    let s = newGame();
    const t = put(s, "V2", "bob");
    s = act(s, putAs(s, "C-EB02"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [t] }).state;
    s = applyIntent(db, s, { type: "respondOption", player: "alice", index: 1 }).state;
    expect(s.players.bob.zones.life[0]).toBe(t);
    expect(s.players.bob.instances[t].faceUp).toBe(true);
  });
});

describe("M5 batch 3m: replacements", () => {
  it("\"Once per turn, this Character cannot be K.O.'d by your opponent's effects\"", () => {
    const rep = getGeneratedCard("OP10-118")!.effects[0];
    CARDS["C-OPTIMM"] = { ...CARDS.V1, id: "C-OPTIMM", compiled: { cardId: "C-OPTIMM", version: 1, confidence: 1, classification: "compiled", keywords: [], effects: [rep] } } as EngineCard;
    let s = newGame();
    const t = put(s, "V2", "bob");
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: "C-OPTIMM" };
    const ko = putAs(s, "C-KO1");
    s = act(s, ko);
    if (s.pendingChoice?.kind === "mayReplace") s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    expect(s.players.bob.zones.characterArea).toContain(t);
    const ko2 = putAs(s, "C-KO1");
    s = act(s, ko2);
    expect(s.players.bob.zones.trash).toContain(t);
  });
});
describe("M5 batch 3m: replacements (2)", () => {
  it("OP11-101: \"you may add it to the top of your Life cards face-down instead\"", () => {
    const rep = getGeneratedCard("OP11-101")!.effects[0];
    CARDS["C-BEGE"] = { ...CARDS.V1, id: "C-BEGE", compiled: { cardId: "C-BEGE", version: 1, confidence: 1, classification: "compiled", keywords: [], effects: [rep] } } as EngineCard;
    CARDS["C-NOVA"] = { ...CARDS.V1, id: "C-NOVA", types: ["Supernovas"] } as EngineCard;
    let s = newGame();
    const src = put(s, "V2", "bob"), t = put(s, "V3", "bob");
    s.players.bob.instances[src] = { ...s.players.bob.instances[src], cardId: "C-BEGE" };
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: "C-NOVA" };
    const life = s.players.bob.zones.life.length;
    s = act(s, putAs(s, "C-KO1"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [t] }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob", targetIid: t });
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    expect(s.players.bob.zones.life.length).toBe(life + 1);
    expect(s.players.bob.zones.life[s.players.bob.zones.life.length - 1]).toBe(t);
    expect(s.players.bob.zones.trash).not.toContain(t);
  });
});

describe("M5 batch 3n: K.O. immunity by source", () => {
  it("\"cannot be K.O.'d by effects of your opponent's Characters with 5000 base power or less\"", () => {
    CARDS["C-IMM5K"] = { ...CARDS.V1, id: "C-IMM5K", compiled: { cardId: "C-IMM5K", version: 1, confidence: 1, classification: "compiled", keywords: [],
      effects: [{ timing: "static", actions: [{ kind: "restriction", sel: sel("self", "characterArea", 1, { self: true }), what: "cannotBeKOdByEffectsOf", duration: "permanentWhileInPlay",
        sourceOpponentOnly: true, sourceFilter: { category: ["Character"], basePowerAtMost: 5000 } }] }] } } as EngineCard;
    CARDS["C-KO1-BIG"] = { ...CARDS["C-KO1"], id: "C-KO1-BIG", power: 6000 } as EngineCard;
    for (const [ko, survives] of [["C-KO1", true], ["C-KO1-BIG", false]] as const) {
      let s = newGame();
      const t = put(s, "V2", "bob");
      s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: "C-IMM5K" };
      s = act(s, putAs(s, ko));
      expect(s.players.bob.zones.characterArea.includes(t)).toBe(survives);
    }
  });
});

describe("M5 batch 3o", () => {
  it("OP12-020: after battling a Character the Leader stands, but cannot attack cost ≤7 Characters", () => {
    const g = getGeneratedCard("OP12-020")!;
    CARDS["L-1220"] = { ...CARDS.L, id: "L-1220", compiled: { ...g, cardId: "L-1220" } } as EngineCard;
    let s = newGame("L-1220");
    s.turn = 3;
    const leader = s.players.alice.leaderIid;
    s.players.alice.don.given[leader] = 3; s.players.alice.don.deck -= 3;
    const t = put(s, "V2", "bob");
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], rested: true };
    expect(legalMoves(db, s).activatable.map((x) => x.iid)).not.toContain(leader);
    s = battle(s, leader, t);
    expect(s.players.alice.instances[leader].rested).toBe(true);
    s = applyIntent(db, s, { type: "activateMain", player: "alice", iid: leader, effectIndex: 0 }).state;
    expect(s.players.alice.instances[leader].rested).toBe(false);
    const t2 = put(s, "V3", "bob");
    s.players.bob.instances[t2] = { ...s.players.bob.instances[t2], rested: true };
    const mine = legalMoves(db, s).attackers.find((x) => x.iid === leader)!;
    expect(mine.targets).not.toContain(t2);
    expect(mine.targets).toContain(s.players.bob.leaderIid);
  });
  it("ST36-005 / ST07-015 / P-025 / OP11-005 / OP14-003 (compiler)", () => {
    expect(getGeneratedCard("ST36-005")!.effects[0].actions[0].kind).toBe("redirectAttack");
    expect(getGeneratedCard("ST07-015")!.effects[0].actions[0]).toMatchObject({ kind: "chooseOne", chooser: "opponent" });
    expect(getGeneratedCard("P-025")!.effects[0].actions[0]).toMatchObject({ what: "cannotBeKOdInBattle", exceptAttributes: ["Special"] });
    expect(getGeneratedCard("OP11-005")!.effects[0].actions[0]).toMatchObject({ what: "cannotBeKOdByEffectsOf" });
    expect(getGeneratedCard("OP14-003")!.effects[0].actions[0]).toMatchObject({ what: "cannotBeKOdByEffectsOf", sourceOpponentOnly: true });
  });
});

const irCard = (id: string, fromId: string, effects?: Effect[], o: Partial<EngineCard> = {}): void => {
  CARDS[id] = { ...CARDS.V1, id, ...o, compiled: { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects: effects ?? getGeneratedCard(fromId)!.effects } } as EngineCard;
};

describe("M5 batch 3p (engine)", () => {
  it("OP03-083: look at 5, trash up to 2, the rest to the bottom", () => {
    irCard("C-0383", "OP03-083", [{ ...getGeneratedCard("OP03-083")!.effects[0], timing: "activateMain" }]);
    let s = newGame();
    const trash = s.players.alice.zones.trash.length;
    s = act(s, putAs(s, "C-0383"));
    expect(s.pendingChoice).toMatchObject({ kind: "peekSelect", mode: "trash", takeCount: 2 });
    if (s.pendingChoice?.kind === "peekSelect") {
      const pc = s.pendingChoice;
      s = applyIntent(db, s, { type: "respondPeek", player: "alice", take: pc.cards.slice(0, 2), restTop: [], restBottom: pc.cards.slice(2) }).state;
    }
    expect(s.players.alice.zones.trash.length).toBe(trash + 2);
  });

  it("OP02-064-style: at the end of this battle, this Character goes to the bottom of the deck", () => {
    irCard("C-0264", "", [{ timing: "whenAttacking", actions: [{ kind: "restriction", what: "toDeckBottomAtEndOfBattle", duration: "thisBattle", sel: sel("self", "characterArea", 1, { self: true }) }] }], { power: 9000 });
    let s = newGame();
    s.turn = 3;
    const me = putAs(s, "C-0264");
    s = battle(s, me, s.players.bob.leaderIid);
    expect(s.players.alice.zones.characterArea).not.toContain(me);
    expect(s.players.alice.zones.deck[s.players.alice.zones.deck.length - 1]).toBe(me);
  });

  it("OP05-001-style: \"give that Character −1000 power instead of it being K.O.'d\"", () => {
    const rep = getGeneratedCard("OP05-001")!.effects[0];
    CARDS["L-0501"] = { ...CARDS.L, id: "L-0501", compiled: { cardId: "L-0501", version: 1, confidence: 1, classification: "compiled", keywords: [], effects: [{ ...rep, conditions: [] }] } } as EngineCard;
    CARDS["C-6K"] = { ...CARDS.V1, id: "C-6K", power: 6000 } as EngineCard;
    let s = newGame();
    s.players.bob.instances[s.players.bob.leaderIid] = { ...s.players.bob.instances[s.players.bob.leaderIid], cardId: "L-0501" };
    const t = put(s, "V2", "bob");
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: "C-6K" };
    s = act(s, putAs(s, "C-KO1"));
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob" });
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    expect(s.players.bob.zones.characterArea).toContain(t);
    expect(effectivePower(db, s, "bob", t)).toBe(5000);
  });
});

describe("M5 batch 3q (engine)", () => {
  it("\"Trash all your face-up Life cards\"; \"return DON!! … until you have the same number as your opponent\"", () => {
    irCard("C-FUTRASH", "", [{ timing: "activateMain", actions: [{ kind: "trashLife", who: "self", count: 99, faceUpOnly: true }, { kind: "returnDonToDeck", who: "self", count: 0, downToOpponent: true }] }]);
    let s = newGame();
    const life = s.players.alice.zones.life;
    s.players.alice.instances[life[0]] = { ...s.players.alice.instances[life[0]], faceUp: true };
    s.players.alice.instances[life[2]] = { ...s.players.alice.instances[life[2]], faceUp: true };
    const n = life.length;
    s.players.alice.don = { ...s.players.alice.don, active: 3, rested: 2, deck: 5 };
    s.players.bob.don = { ...s.players.bob.don, active: 2, deck: 8 };
    s = act(s, putAs(s, "C-FUTRASH"));
    expect(s.players.alice.zones.life.length).toBe(n - 2);
    expect(s.players.alice.don.active + s.players.alice.don.rested).toBe(2);
  });
  it("\"Your face-up Life cards are placed at the bottom of your deck instead of being added to your hand\"", () => {
    irCard("L-FUDECK", "", [{ timing: "static", actions: [{ kind: "restriction", sel: sel("self", "leader", 1), what: "faceUpLifeToDeck", duration: "permanentWhileInPlay" }] }],
      { category: "Leader", cost: 5, power: 5000 });
    let s = newGame();
    s.players.bob.instances[s.players.bob.leaderIid] = { ...s.players.bob.instances[s.players.bob.leaderIid], cardId: "L-FUDECK" };
    const top = s.players.bob.zones.life[s.players.bob.zones.life.length - 1];
    s.players.bob.instances[top] = { ...s.players.bob.instances[top], faceUp: true };
    const hand = s.players.bob.zones.hand.length;
    s = act(s, putAs(s, "C-DMG"));
    if (s.pendingChoice?.kind === "triggerDecision") s = applyIntent(db, s, { type: "respondTrigger", player: "bob", activate: false }).state;
    expect(s.players.bob.zones.hand.length).toBe(hand);
    expect(s.players.bob.zones.deck[s.players.bob.zones.deck.length - 1]).toBe(top);
  });
  it("\"gains the <Slash> attribute during this turn\"", () => {
    irCard("C-SLASH", "", [{ timing: "activateMain", actions: [{ kind: "restriction", sel: sel("self", "characterArea", 1, { self: true }), what: "gainsAttribute", attributes: ["Slash"], duration: "thisTurn" }] }]);
    let s = newGame();
    const me = putAs(s, "C-SLASH");
    expect(matchesFilterOf(s, me, { attributes: ["Slash"] })).toBe(false);
    s = act(s, me);
    expect(matchesFilterOf(s, me, { attributes: ["Slash"] })).toBe(true);
  });
});
function matchesFilterOf(s: AutoGameState, iid: string, filter: Selector["filter"]): boolean {
  return matchesFilter(db, s, "alice", iid, filter, iid, true);
}
describe("M5 batch 3r", () => {
  it("ST28-004: return 2 given DON!! to the cost area rested → [Rush] and +1000", () => {
    irCard("C-2804", "ST28-004");
    let s = newGame();
    const me = putAs(s, "C-2804");
    s.players.alice.don.given = { [me]: 1, [s.players.alice.leaderIid]: 1 };
    s.players.alice.don.deck -= 2;
    s = applyIntent(db, s, { type: "activateMain", player: "alice", iid: me, effectIndex: 1 }).state;
    if (s.pendingChoice?.kind === "mayActivate") s = applyIntent(db, s, { type: "respondMay", player: "alice", activate: true }).state;
    expect(s.players.alice.don.given).toEqual({});
    expect(s.players.alice.don.rested).toBe(2);
    expect([...keywordsOf(db, s, "alice", me)]).toContain("Rush");
  });
});
describe("M5 batch 3s", () => {
  it("OP01-063: reveal a chosen card of the opponent's hand; an Event sends 1 of their Life cards to the bottom of their deck", () => {
    const fx = getGeneratedCard("OP01-063")!.effects[0];
    irCard("C-0163", "", [{ ...fx, conditions: [] }]);
    CARDS["E-X"] = { ...CARDS.V1, id: "E-X", category: "Event" } as EngineCard;
    for (const [id, moved] of [["E-X", true], ["V2", false]] as const) {
      let s = newGame();
      const h = s.players.bob.zones.hand[0];
      s.players.bob.instances[h] = { ...s.players.bob.instances[h], cardId: id };
      const life = s.players.bob.zones.life.length;
      s = act(s, putAs(s, "C-0163"));
      if (s.pendingChoice?.kind === "mayActivate") s = applyIntent(db, s, { type: "respondMay", player: "alice", activate: true }).state;
      if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [h] }).state;
      if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [s.pendingChoice.candidates[0].iid] }).state;
      expect(s.players.bob.zones.life.length).toBe(moved ? life - 1 : life);
    }
  });
  it("board-auto: a generated IR that runs wins over a manual M2 one (OP01-002, OP01-105)", async () => {
    const { compiledFor } = await import("../../features/board-auto/compile");
    for (const id of ["OP01-002", "OP01-105", "OP01-063"]) {
      const ir = compiledFor({ id, category: "Character" } as Parameters<typeof compiledFor>[0])!;
      expect(JSON.stringify(ir.effects), id).not.toContain('"kind":"manual"');
    }
  });
});
describe("M5 batch 3t", () => {
  it("\"When this Character battles <Strike> attribute Characters, +3000\"", () => {
    irCard("C-0510", "", [getGeneratedCard("ST05-010")!.effects[0]], { power: 3000 });
    CARDS["C-STRIKE"] = { ...CARDS.V1, id: "C-STRIKE", attributes: ["Strike"] } as EngineCard;
    for (const [id, p] of [["C-STRIKE", 6000], ["V2", 3000]] as const) {
      let s = newGame();
      s.turn = 3;
      const me = putAs(s, "C-0510");
      const t = put(s, "V3", "bob");
      s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: id, rested: true };
      s = applyIntent(db, s, { type: "attack", player: "alice", attackerIid: me, targetIid: t }).state;
      expect(effectivePower(db, s, "alice", me)).toBe(p);
    }
  });
  it("OP12-040 / OP12-081 (compiler)", () => {
    expect(getGeneratedCard("OP12-040")!.effects[0]).toMatchObject({ timing: "onHandTrashed", react: { sourceFilter: { typeIncludes: ["Navy"] } } });
    expect(getGeneratedCard("OP12-081")!.effects[1]).toMatchObject({ timing: "onYouPlayCharacter", react: { whose: "opponents", orSourceFilter: { category: ["Character"] } } });
  });
});
describe("M5 batch 3u", () => {
  it("\"When a card is trashed from your hand by your {Navy} type card's effect, draw …\"", () => {
    irCard("L-NAVYW", "", [getGeneratedCard("OP12-040")!.effects[0]], { category: "Leader", cost: 5, power: 5000 });
    irCard("C-DISC1", "", [{ timing: "activateMain", actions: [{ kind: "discard", who: "self", sel: sel("self", "hand", 1) }] }]);
    irCard("C-DISC1N", "", [{ timing: "activateMain", actions: [{ kind: "discard", who: "self", sel: sel("self", "hand", 1) }] }], { types: ["Navy"] });
    for (const [id, drawn] of [["C-DISC1N", 1], ["C-DISC1", 0]] as const) {
      let s = newGame();
      s.players.alice.instances[s.players.alice.leaderIid] = { ...s.players.alice.instances[s.players.alice.leaderIid], cardId: "L-NAVYW" };
      const hand = s.players.alice.zones.hand.length;
      s = act(s, putAs(s, id));
      if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [s.pendingChoice.candidates[0].iid] }).state;
      expect(s.players.alice.zones.hand.length - (hand - 1)).toBe(drawn);
    }
  });
});
describe("M5 batch 3v", () => {
  it("EB02-039: play from the trash a Character with the same name as the trashed one", () => {
    irCard("C-0239", "", [{ ...getGeneratedCard("EB02-039")!.effects[0], timing: "activateMain" }]);
    CARDS["C-G1"] = { ...CARDS.V1, id: "C-G1", name: "Germa", power: 4000, types: ["GERMA 66"] } as EngineCard;
    CARDS["C-G2"] = { ...CARDS.V1, id: "C-G2", name: "Germa", power: 6000 } as EngineCard;
    CARDS["C-OTHER6"] = { ...CARDS.V1, id: "C-OTHER6", name: "Other", power: 6000 } as EngineCard;
    let s = newGame();
    const a = s.players.alice;
    const [h, t1, t2] = a.zones.deck.splice(0, 3);
    a.instances[h] = { ...a.instances[h], cardId: "C-G1" }; a.zones.hand.push(h);
    a.instances[t1] = { ...a.instances[t1], cardId: "C-G2" }; a.instances[t2] = { ...a.instances[t2], cardId: "C-OTHER6" };
    a.zones.trash.push(t1, t2);
    s.players.bob.don = { ...s.players.bob.don, active: 3, deck: 7 };
    s = act(s, putAs(s, "C-0239"));
    if (s.pendingChoice?.kind === "mayActivate") s = applyIntent(db, s, { type: "respondMay", player: "alice", activate: true }).state;
    if (s.pendingChoice?.kind === "selectTargets" && s.pendingChoice.candidates.some((c) => c.iid === h)) s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [h] }).state;
    if (s.pendingChoice?.kind === "selectTargets") {
      expect(s.pendingChoice.candidates.map((c) => c.iid)).toEqual([t1]);
      s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [t1] }).state;
    }
    expect(s.players.alice.zones.characterArea).toContain(t1);
  });
});

describe("M5 batch 3w: the last five", () => {
  it("PRB02-006: \"If this Character would be rested by your opponent's effect, you may rest 1 of your other Characters instead\"", () => {
    irCard("C-PRB6", "", [{ ...getGeneratedCard("PRB02-006")!.effects[0], conditions: [] }]);
    irCard("C-REST1", "", [{ timing: "activateMain", actions: [{ kind: "restTarget", sel: sel("opponent", "characterArea", 1) }] }]);
    let s = newGame();
    const me = put(s, "V2", "bob"); const other = put(s, "V3", "bob");
    s.players.bob.instances[me] = { ...s.players.bob.instances[me], cardId: "C-PRB6" };
    s = act(s, putAs(s, "C-REST1"));
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [me] }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob" });
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "bob", iids: [other] }).state;
    expect(s.players.bob.instances[me].rested).toBe(false);
    expect(s.players.bob.instances[other].rested).toBe(true);
  });

  it("PRB02-005: the opponent rests 1 active DON!! at the start of their next Main Phase", () => {
    irCard("C-PRB5", "", [{ ...getGeneratedCard("PRB02-005")!.effects[0], timing: "activateMain", conditions: [] }]);
    let s = newGame();
    s = act(s, putAs(s, "C-PRB5"));
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.players.bob.don.active).toBe(1); // 2 placed, 1 rested
    expect(s.players.bob.don.rested).toBe(1);
  });

  it("EB02-030: \"If any of your Characters would be K.O.'d in battle during this turn, you may trash 1 card from your hand instead\"", () => {
    const ir = getGeneratedCard("EB02-030")!;
    CARDS["E-0230"] = { ...CARDS.V1, id: "E-0230", category: "Event", compiled: { ...ir, cardId: "E-0230", effects: [{ ...ir.effects[0], timing: "activateMain" }, ir.effects[1], ir.effects[2]] } } as EngineCard;
    let s = newGame();
    s.turn = 3;
    const ev = putAs(s, "E-0230"); // played from the field for the test, then moved to the trash
    s = act(s, ev);
    s.players.alice.zones.characterArea = s.players.alice.zones.characterArea.filter((x) => x !== ev);
    s.players.alice.zones.trash.push(ev);
    // bob attacks alice's rested Character on his turn: simulate with alice attacking? use bob's attack
    const mine = putAs(s, "V1");
    s.players.alice.instances[mine] = { ...s.players.alice.instances[mine], rested: true };
    const big = put(s, "C-6", "bob");
    CARDS["C-6"] = { ...CARDS["C-6"], power: 9000 };
    s.turnPlayer = "bob"; s.turn = 4;
    s = applyIntent(db, s, { type: "attack", player: "bob", attackerIid: big, targetIid: mine }).state;
    for (let i = 0; i < 6 && s.battle && s.pendingChoice?.kind !== "mayReplace"; i++) {
      if (s.battle.step === "block") s = applyIntent(db, s, { type: "respondBlock", player: "alice", blockerIid: null }).state;
      else if (s.battle.step === "counter") s = applyIntent(db, s, { type: "passCounter", player: "alice" }).state;
    }
    CARDS["C-6"] = { ...CARDS["C-6"], power: 2000 };
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "alice", sourceIid: ev, battle: true });
    const hand = s.players.alice.zones.hand.length;
    s = applyIntent(db, s, { type: "respondReplace", player: "alice", use: true }).state;
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [s.pendingChoice.candidates[0].iid] }).state;
    expect(s.players.alice.zones.characterArea).toContain(mine);
    expect(s.players.alice.zones.hand.length).toBe(hand - 1);
  });

  it("OP08-043: attacking costs 2 cards from the hand", () => {
    irCard("C-0843", "", [{ ...getGeneratedCard("OP08-043")!.effects[0], timing: "activateMain", conditions: [] }]);
    let s = newGame();
    s.turn = 3;
    const atk = put(s, "V2", "bob");
    s = act(s, putAs(s, "C-0843"));
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    const hand = s.players.bob.zones.hand.length;
    s = applyIntent(db, s, { type: "attack", player: "bob", attackerIid: atk, targetIid: s.players.alice.leaderIid }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "bob" });
    if (s.pendingChoice?.kind === "selectTargets") s = applyIntent(db, s, { type: "respondTargets", player: "bob", iids: s.pendingChoice.candidates.slice(0, 2).map((c) => c.iid) }).state;
    expect(s.players.bob.zones.hand.length).toBe(hand - 2);
    s.players.bob.zones.hand = s.players.bob.zones.hand.slice(0, 1);
    expect(legalMoves(db, { ...s, battle: null, pendingChoice: null }).attackers.find((x) => x.iid === atk)).toBeUndefined();
  });

  it("EB05-052: \"If you would take damage, you may trash this Character instead\"", () => {
    irCard("C-0552", "EB05-052");
    let s = newGame();
    s.turn = 3;
    const t = put(s, "V2", "bob");
    s.players.bob.instances[t] = { ...s.players.bob.instances[t], cardId: "C-0552" };
    const life = s.players.bob.zones.life.length;
    s = applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: s.players.bob.leaderIid }).state;
    for (let i = 0; i < 6 && s.battle && s.pendingChoice?.kind !== "mayReplace"; i++) {
      if (s.battle.step === "block") s = applyIntent(db, s, { type: "respondBlock", player: "bob", blockerIid: null }).state;
      else if (s.battle.step === "counter") s = applyIntent(db, s, { type: "passCounter", player: "bob" }).state;
    }
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob", damage: true });
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    expect(s.players.bob.zones.life.length).toBe(life);
    expect(s.players.bob.zones.trash).toContain(t);
  });
});
describe("M5 batch 3x: \"up to\" DON!!", () => {
  it("\"set up to 2 of your DON!! as active\" / \"add up to 1 DON!!\": the player picks how many", () => {
    irCard("C-UPDON", "", [{ timing: "activateMain", actions: [{ kind: "standDon", count: 2, upTo: true }, { kind: "placeDonInCostArea", count: 1, upTo: true, rested: true }] }]);
    let s = newGame();
    s.players.alice.don = { ...s.players.alice.don, active: 0, rested: 3, deck: 7 };
    s = act(s, putAs(s, "C-UPDON"));
    expect(s.pendingChoice).toMatchObject({ kind: "chooseNumber", purpose: "standDon", max: 2 });
    s = applyIntent(db, s, { type: "respondNumber", player: "alice", value: 1 }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "chooseNumber", purpose: "addDon", max: 1 });
    s = applyIntent(db, s, { type: "respondNumber", player: "alice", value: 0 }).state;
    expect(s.players.alice.don).toMatchObject({ active: 1, rested: 2, deck: 7 });
  });
});
