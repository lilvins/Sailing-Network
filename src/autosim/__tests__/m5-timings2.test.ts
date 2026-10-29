import { describe, expect, it } from "vitest";
import type { Action, Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { legalMoves } from "../engine/legality";
import { markStateEdited } from "../engine/stateVersion";
import { effectivePower, keywordsOf, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 event timings, second batch: your Leader attacks / is attacked, you
 * take damage, a Life card is removed, your opponent activates [Blocker]
 * (and "you win the game"), a Character played from your trash ("that
 * Character"), counters in the hand.
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
const draw: Action = { kind: "draw", count: 1 };
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-LATK", [{ timing: "onLeaderAttacks", actions: [draw] }]);
addCard("C-LDEF", [{ timing: "onLeaderAttacked", actions: [draw] }]);
addCard("C-DMG", [{ timing: "onTakeDamage", actions: [draw] }]);
addCard("C-LIFE", [{ timing: "onLifeRemoved", actions: [draw] }]);
addCard("C-WIN", [{ timing: "onOpponentBlocks", conditions: [{ kind: "lifeAtMost", who: "opponent", count: 5 }], actions: [{ kind: "winGame" }] }]);
addCard("C-BLK", []);
CARDS["C-BLK"].compiled!.keywords = ["Blocker"];
addCard("C-RUSHT", [{ timing: "onYouPlayCharacter", react: { whose: "yours", fromTrash: true, filter: { category: ["Character"] } },
  actions: [{ kind: "grantKeyword", sel: sel("self", "characterArea", 1, { prev: true }), keyword: "Rush", duration: "thisTurn" }] }]);
addCard("C-REVIVE", [{ timing: "activateMain", actions: [{ kind: "playFromZone", zone: "trash", free: true, sel: sel("self", "trash", 1, { filter: { nameIncludes: ["X1"] } }) }] }]);
addCard("C-CTR", [{ timing: "static", actions: [{ kind: "setCounter", sel: sel("self", "hand", 99, { filter: { counter: "none" } }), amount: 1000, duration: "permanentWhileInPlay" }] }]);
addCard("V0", null, { counter: 0 });
addCard("C-ONDON", [{ timing: "onDonGiven", actions: [draw] },
  { timing: "static", actions: [{ kind: "restriction", sel: sel("self", "characterArea", 1, { self: true, filter: { playedThisTurn: true } }), what: "cannotAttackLeaders", duration: "permanentWhileInPlay" }] }]);
addCard("C-DMG1", [{ timing: "activateMain", actions: [{ kind: "dealDamage", who: "opponent", count: 1 }, draw] }]);
addCard("T-DRAW", [{ timing: "trigger", actions: [{ kind: "draw", count: 2 }] }]);
addCard("C-LURE", [{ timing: "static", conditions: [{ kind: "selfRested" }], actions: [{ kind: "restriction", sel: sel("self", "characterArea", 1, { self: true }), what: "onlyAttackTarget", duration: "permanentWhileInPlay" }] }]);
// [Activate: Main] give 1 of your opponent's rested DON!! to 1 of their Characters; then all their Characters −1000 per DON!! given
addCard("C-KRIEG", [{ timing: "activateMain", actions: [
  { kind: "giveRestedDon", sel: sel("opponent", "characterArea", 1), count: 2 },
  { kind: "powerMod", sel: sel("opponent", "characterArea", 99), amount: -1000, duration: "thisTurn", perGivenDon: true }] }]);
for (let i = 1; i <= 2; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-LATK", "C-LDEF", "C-DMG", "C-LIFE", "C-WIN", "C-BLK", "C-RUSHT", "C-REVIVE", "C-CTR", "V0", "C-LURE", "C-KRIEG", "C-DMG1"]
  .flatMap((id) => Array<string>(3).fill(id));
const FULL = [...DECK, "X1", "X2", "T-DRAW", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "C-ONDON"];
addCard("X1", null); addCard("X2", null);
for (let i = 1; i <= 8; i++) addCard(`F${i}`, null);
function newGame(): AutoGameState {
  const config: GameConfig = { seed: "m5t2", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: FULL }, { id: "bob", leader: "L", deck: FULL }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  s.turn = 3;
  markStateEdited(s);
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "trash" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); markStateEdited(s); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
/** Leader attacks bob's Leader; nobody blocks or counters. */
function leaderAttack(s: AutoGameState, block?: string): AutoGameState {
  s = applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: s.players.bob.leaderIid }).state;
  let guard = 30;
  while (s.pendingChoice && guard-- > 0) {
    const pc = s.pendingChoice;
    if (pc.kind === "blockWindow") s = applyIntent(db, s, { type: "respondBlock", player: pc.player, blockerIid: block ?? null }).state;
    else if (pc.kind === "counterWindow") s = applyIntent(db, s, { type: "passCounter", player: pc.player }).state;
    else if (pc.kind === "triggerDecision") s = applyIntent(db, s, { type: "respondTrigger", player: pc.player, activate: false }).state;
    else break;
  }
  return s;
}

describe("M5 event timings (2)", () => {
  it("your Leader attacks / is attacked; you take damage; a Life card is removed", () => {
    let s = newGame();
    put(s, "C-LATK"); put(s, "C-LDEF", "bob"); put(s, "C-DMG", "bob"); put(s, "C-LIFE"); put(s, "C-LIFE", "bob");
    const a = s.players.alice.zones.hand.length;
    const b = s.players.bob.zones.hand.length;
    s = leaderAttack(s);
    expect(s.players.alice.zones.hand.length).toBe(a + 1 + 1);      // leader attacks + a Life card removed
    expect(s.players.bob.zones.hand.length).toBe(b + 1 + 1 + 1 + 1); // attacked + damage + Life removed + the Life card itself
  });

  it("\"when your opponent activates [Blocker] … you win the game\"", () => {
    let s = newGame();
    put(s, "C-WIN");
    const blocker = put(s, "C-BLK", "bob");
    s = leaderAttack(s, blocker);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("alice");
    expect(s.winReason).toBe("effect");
  });

  it("a Character played from your trash gains [Rush] (\"that Character\")", () => {
    let s = newGame();
    put(s, "C-RUSHT");
    const v1 = put(s, "X1", "alice", "trash");
    s = applyIntent(db, s, { type: "activateMain", player: "alice", iid: put(s, "C-REVIVE"), effectIndex: 0 }).state;
    expect(s.players.alice.zones.characterArea).toContain(v1);
    expect(keywordsOf(db, s, "alice", v1).has("Rush")).toBe(true);
  });

  it("\"Characters in your hand without a Counter have a +1000 Counter\"", () => {
    let s = newGame();
    put(s, "C-CTR", "bob");
    const p = s.players.bob;
    const v0 = p.zones.deck.find((iid) => p.instances[iid].cardId === "V0")!;
    p.zones.deck = p.zones.deck.filter((x) => x !== v0);
    p.zones.hand.push(v0);
    s = applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: s.players.bob.leaderIid }).state;
    if (s.pendingChoice?.kind === "blockWindow") s = applyIntent(db, s, { type: "respondBlock", player: "bob", blockerIid: null }).state;
    expect(s.pendingChoice?.kind).toBe("counterWindow");
    expect(legalMoves(db, s).counterCards).toContainEqual({ iid: v0, amount: 1000 });
    s = applyIntent(db, s, { type: "useCounter", player: "bob", cardIid: v0, targetIid: s.players.bob.leaderIid }).state;
    expect(effectivePower(db, s, "bob", s.players.bob.leaderIid)).toBe(6000);
  });
});

describe("M5 the opponent's DON!!", () => {
  it("gives the opponent's rested DON!! to their Character; −1000 for every DON!! given to it", () => {
    let s = newGame();
    const target = put(s, "X2", "bob");
    s.players.bob.don.rested = 3;
    s = applyIntent(db, s, { type: "activateMain", player: "alice", iid: put(s, "C-KRIEG"), effectIndex: 0 }).state;
    expect(s.players.bob.don.given[target]).toBe(2);
    expect(s.players.bob.don.rested).toBe(1);
    // 2000 base − 2 × 1000 (given DON!! add power only on their owner's turn, 6-5-5-2)
    expect(effectivePower(db, s, "bob", target)).toBe(2000 - 2000);
  });
});

describe("M5 DON!! given / no Leader attacks", () => {
  it("\"when … is given a DON!! card\" draws; the card played this turn can't attack a Leader", () => {
    let s = newGame();
    const me = put(s, "C-ONDON");
    s.players.alice.don.active = 2;
    const h = s.players.alice.zones.hand.length;
    s = applyIntent(db, s, { type: "giveDon", player: "alice", targetIid: s.players.alice.leaderIid }).state;
    expect(s.players.alice.zones.hand.length).toBe(h + 1);
    expect(legalMoves(db, s).attackers.find((x) => x.iid === me)).toBeDefined(); // not played this turn (put, no playedOnTurn)
    s.players.alice.instances[me].playedOnTurn = s.turn;
    s.players.alice.instances[me] = { ...s.players.alice.instances[me] };
    const att = legalMoves(db, s).attackers.find((x) => x.iid === me);
    expect(att?.targets ?? []).not.toContain(s.players.bob.leaderIid);
  });
});

describe("M5 effect damage", () => {
  it("\"deal 1 damage to your opponent\": Life to the hand, a [Trigger] offered, then the effect goes on; at 0 Life the game ends", () => {
    let s = newGame();
    const bob = s.players.bob;
    const trig = Object.values(bob.instances).find((x) => x.cardId === "T-DRAW")!.iid;
    for (const z of ["deck", "hand", "life"] as const) bob.zones[z] = bob.zones[z].filter((x) => x !== trig);
    bob.zones.life.push(trig); // on top
    const bh = bob.zones.hand.length, ah = s.players.alice.zones.hand.length;
    s = applyIntent(db, s, { type: "activateMain", player: "alice", iid: put(s, "C-DMG1"), effectIndex: 0 }).state;
    expect(s.pendingChoice).toMatchObject({ kind: "triggerDecision", player: "bob", iid: trig, effectDamage: true });
    s = applyIntent(db, s, { type: "respondTrigger", player: "bob", activate: true }).state;
    expect(s.players.bob.zones.hand.length).toBe(bh + 2);
    expect(s.players.bob.zones.trash).toContain(trig);
    expect(s.players.alice.zones.hand.length).toBe(ah + 1); // the rest of the effect

    let t = newGame();
    t.players.bob.zones.life = [];
    t = applyIntent(db, t, { type: "activateMain", player: "alice", iid: put(t, "C-DMG1"), effectIndex: 0 }).state;
    expect(t.phase).toBe("over");
    expect(t.winner).toBe("alice");
  });
});

describe("M5 attack lure", () => {
  it("\"your opponent cannot attack any card other than [this Character]\" while it is rested", () => {
    const s = newGame();
    const lure = put(s, "C-LURE", "bob");
    const other = put(s, "V0", "bob");
    s.players.bob.instances[other].rested = true;
    markStateEdited(s);
    const targets = () => legalMoves(db, s).attackers.find((x) => x.iid === s.players.alice.leaderIid)!.targets;
    expect(targets()).toEqual(expect.arrayContaining([s.players.bob.leaderIid, other]));
    s.players.bob.instances[lure].rested = true;
    markStateEdited(s);
    expect(targets()).toEqual([lure]);
    expect(() => applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: s.players.bob.leaderIid })).toThrow();
  });
});

describe("M5 compiler: event timings (2)", () => {
  it("OP17-040: your Leader attacks or is attacked", () => {
    const t = getGeneratedCard("OP17-040")!.effects.map((e) => e.timing);
    expect(t).toEqual(expect.arrayContaining(["onLeaderAttacks", "onLeaderAttacked"]));
  });
  it("OP13-002: when you take damage or your 6000-base-power Character is K.O.'d", () => {
    const t = getGeneratedCard("OP13-002")!.effects.map((e) => e.timing);
    expect(t).toEqual(expect.arrayContaining(["onTakeDamage", "onCharacterKOd"]));
  });
  it("OP09-118: [Blocker] at 0 Life → you win", () => {
    expect(getGeneratedCard("OP09-118")!.effects.find((e) => e.timing === "onOpponentBlocks")!.actions).toEqual([{ kind: "winGame" }]);
  });
  it("OP16-079 / OP14-041 / OP11-041", () => {
    expect(getGeneratedCard("OP16-079")!.effects[0]).toMatchObject({ timing: "onYouPlayCharacter", react: { fromTrash: true } });
    expect(getGeneratedCard("OP14-041")!.effects[0]).toMatchObject({ timing: "onYouPlayCharacter", conditions: [{ kind: "opponentsTurn" }] });
    expect(getGeneratedCard("OP11-041")!.effects[0].timing).toBe("onLifeRemoved");
  });
  it("OP16-118 / OP17-063: counters in the hand", () => {
    expect(getGeneratedCard("OP16-118")!.effects[0].actions[0]).toMatchObject({ kind: "setCounter", amount: 2000 });
    expect(getGeneratedCard("OP17-063")!.effects[0].actions[0]).toMatchObject({ kind: "setCounter", amount: 1000, sel: { filter: { counter: "none" } } });
  });
});
