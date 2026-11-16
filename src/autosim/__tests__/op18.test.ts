import { describe, expect, it } from "vitest";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { PlayerIntent as Intent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import { markStateEdited } from "../engine/stateVersion";
import { effectivePower, keywordsOf, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import type { CompiledCard, Effect } from "../ir/types";
import { getGeneratedCard } from "../data/compiled";

/**
 * OP18 cards whose wording needed something new in the IR or the engine,
 * played with their real compiled effects.
 */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, o: Partial<EngineCard> = {}): void {
  CARDS[id] = { id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o } as EngineCard;
}
function addReal(id: string, o: Partial<EngineCard> = {}): void {
  addCard(id, { compiled: getGeneratedCard(id)!, ...o });
}
const compiled = (cardId: string, effects: Effect[]): CompiledCard =>
  ({ cardId, version: 1, confidence: 1, classification: "compiled", keywords: [], effects });

addCard("L", { category: "Leader", cost: 5, power: 5000 });
addCard("L-CP9", { category: "Leader", cost: 5, power: 5000, types: ["CP9"] });
addCard("L-CP6", { category: "Leader", cost: 5, power: 5000, types: ["CP6"] });
addReal("OP18-001", { category: "Leader", cost: 4, power: 5000, name: "Karoo", types: ["Animal", "Alabasta"] });
addReal("OP18-021", { category: "Leader", cost: 4, power: 5000, name: "Franky", types: ["Water Seven", "The Franky Family", "Straw Hat Crew"] });
addReal("OP18-060", { category: "Leader", cost: 4, power: 5000, name: "Saint Gunko", types: ["Celestial Dragons", "Holy Knights of God"] });
addReal("OP18-011", { cost: 2, power: 0, name: "Nefeltari Vivi", types: ["Alabasta"] });
addReal("OP18-012", { cost: 1, power: 0, name: "Pincers", types: ["Animal", "Alabasta"] });
addReal("OP18-061", { cost: 2, power: 0, name: "Iceburg", types: ["Water Seven", "Galley-La Company"] });
addReal("OP18-105", { cost: 1, power: 1000, name: "Spandam", types: ["CP9"] });
addCard("DUCK", { types: ["Animal", "Alabasta"] });
addCard("ANIMAL", { types: ["Animal"] });
addCard("ALABASTA", { types: ["Alabasta"] });
// the whole deck: the tests turn copies of it into the cards they need
addCard("FILLER", { compiled: { ...compiled("FILLER", []), classification: "vanilla", rules: { anyCopies: true } } });
addCard("STAGE", { category: "Stage", cost: 1, power: null, counter: null });
addCard("EVENT", { category: "Event", cost: 1, power: null, counter: null });
addCard("W7", { types: ["Water Seven"] });
// "play up to 1 Character from your trash"
addCard("REVIVER", { compiled: compiled("REVIVER", [{ timing: "activateMain", actions: [{ kind: "playFromZone", zone: "trash", free: true,
  sel: { owner: "self", zone: "trash", count: 1, chooser: "controller", filter: { category: ["Character"] } } }] }]) });
// {CP9} cards with a [Trigger]: "Draw 1 card." / "Play this card."
addCard("CP-DRAW", { types: ["CP9"], compiled: compiled("CP-DRAW", [{ timing: "trigger", actions: [{ kind: "draw", count: 1 }] }]) });
addCard("CP-PLAY", { types: ["CP9"], compiled: compiled("CP-PLAY", [{ timing: "trigger", actions: [{ kind: "playFromZone", zone: "hand", free: true,
  sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" } }] }]) });
addCard("CP-PLAIN", { types: ["CP9"] });
addCard("OTHER-TRIGGER", { compiled: compiled("OTHER-TRIGGER", [{ timing: "trigger", actions: [{ kind: "draw", count: 1 }] }]) });

addCard("L-VIVI", { category: "Leader", cost: 5, power: 5000, name: "Nefeltari Vivi", types: ["Alabasta"] });
addCard("L-SPANDAM", { category: "Leader", cost: 4, power: 5000, name: "Spandam", types: ["CP9"] });
addReal("OP09-081", { category: "Leader", cost: 5, power: 5000, name: "Marshall.D.Teach", types: ["The Four Emperors", "Blackbeard Pirates"] });
addReal("OP18-019", { category: "Event", cost: 1, power: null, counter: null, name: "Quack!!!", types: ["Animal", "Alabasta"] });
addReal("OP18-020", { category: "Event", cost: 1, power: null, counter: null, name: "Stop Fighting!!!", types: ["Alabasta"] });
addReal("OP18-058", { category: "Event", cost: 3, power: null, counter: null, name: "This Kingdom is Doomed. You Can't Save It!", types: ["Baroque Works"] });
addReal("OP18-064", { cost: 5, power: 6000, name: "Saint Killingham", types: ["Celestial Dragons", "Holy Knights of God"] });
addReal("OP18-080", { cost: 4, power: 5000, name: "Van Augur", types: ["Egghead", "Blackbeard Pirates"] });
addReal("OP18-117", { category: "Event", cost: 10, power: null, counter: null, name: "Buster Call", types: ["Navy", "CP9"] });
addCard("BIG", { power: 7000 });
addCard("SMALL-3000", { power: 3000 });
addCard("SMALL-4000", { power: 4000 });
addCard("CP6-DRAW", { types: ["CP6"], compiled: compiled("CP6-DRAW", [{ timing: "trigger", actions: [{ kind: "draw", count: 1 }] }]) });
// "You may trash 1 card from your hand: Draw 1 card." on a Character
addCard("DISCARDER", { compiled: compiled("DISCARDER", [{ timing: "activateMain", optional: true,
  cost: [{ kind: "trashFromHand", sel: { owner: "self", zone: "hand", count: 1, chooser: "controller" } }], actions: [{ kind: "draw", count: 1 }] }]) });

addCard("VA-MOMONGA", { name: "Momonga", types: ["Vice Admiral", "Navy"] });
addCard("VA-ONIGUMO", { name: "Onigumo", types: ["Vice Admiral", "Navy"] });
addCard("VA-DOBERMAN", { name: "Doberman", types: ["Vice Admiral", "Navy"] });
const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = Array<string>(50).fill("FILLER");

function newGame(leader = "L"): AutoGameState {
  const config: GameConfig = { seed: "op18", firstPlayer: "alice", players: [{ id: "alice", leader, deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  s.turn = 3; // alice's 2nd turn: attacks are legal
  return s;
}
type Zone = "characterArea" | "hand" | "trash" | "deck" | "life" | "stage";
/** Moves a FILLER of the deck to `zone` as a copy of `cardId` (the top of the deck / Life for those zones). */
function put(s: AutoGameState, cardId: string, zone: Zone = "characterArea", pid: PID = "alice"): string {
  const p = s.players[pid];
  const iid = p.zones.deck.pop()!;
  p.instances[iid].cardId = cardId;
  if (zone === "deck") p.zones.deck.unshift(iid);
  else p.zones[zone].push(iid);
  markStateEdited(s);
  return iid;
}
const go = (s: AutoGameState, i: Intent) => applyIntent(db, s, i).state;
const candidates = (s: AutoGameState): string[] =>
  s.pendingChoice?.kind === "selectTargets" ? s.pendingChoice.candidates.map((c) => c.iid).sort() : [];
/** bob's turn starts and bob's Leader attacks alice's Leader; alice does not block. */
function bobAttacksAlice(s: AutoGameState): AutoGameState {
  s = go(s, { type: "endTurn", player: "alice" });
  s = go(s, { type: "attack", player: "bob", attackerIid: s.players.bob.leaderIid, targetIid: s.players.alice.leaderIid });
  if (s.pendingChoice?.kind === "blockWindow") s = go(s, { type: "respondBlock", player: "alice", blockerIid: null });
  return s;
}

describe("OP18: \"with both the {Animal} and {Alabasta} types\"", () => {
  it("OP18-001 Karoo gives [Rush] and +1000 only to Characters with both types", () => {
    const s = newGame("OP18-001");
    const duck = put(s, "DUCK"), animal = put(s, "ANIMAL"), alabasta = put(s, "ALABASTA");
    expect(effectivePower(db, s, "alice", duck)).toBe(3000);
    expect(keywordsOf(db, s, "alice", duck).has("Rush")).toBe(true);
    for (const iid of [animal, alabasta]) {
      expect(effectivePower(db, s, "alice", iid)).toBe(2000);
      expect(keywordsOf(db, s, "alice", iid).has("Rush")).toBe(false);
    }
  });

  it("OP18-011 Vivi gives +1000 to them, and is not one herself", () => {
    const s = newGame();
    const vivi = put(s, "OP18-011"), duck = put(s, "DUCK"), alabasta = put(s, "ALABASTA");
    expect(effectivePower(db, s, "alice", duck)).toBe(3000);
    expect(effectivePower(db, s, "alice", alabasta)).toBe(2000);
    expect(effectivePower(db, s, "alice", vivi)).toBe(0);
  });

  it("OP18-012 Pincers offers only those Characters when it attacks", () => {
    let s = newGame();
    const pincers = put(s, "OP18-012"), duck = put(s, "DUCK");
    put(s, "ANIMAL"); put(s, "ALABASTA");
    s = go(s, { type: "attack", player: "alice", attackerIid: pincers, targetIid: s.players.bob.leaderIid });
    expect(candidates(s)).toEqual([pincers, duck].sort());
    s = go(s, { type: "respondTargets", player: "alice", iids: [duck] });
    expect(effectivePower(db, s, "alice", duck)).toBe(3000);
  });
});

describe("OP18-021 Franky: \"All Stage cards in your hand have a +3000 Counter\"", () => {
  it("a Stage in the hand can be trashed as a 3000 counter; an Event cannot", () => {
    let s = newGame("OP18-021");
    const stage = put(s, "STAGE", "hand"), event = put(s, "EVENT", "hand");
    s = bobAttacksAlice(s);
    expect(s.pendingChoice).toMatchObject({ kind: "counterWindow", player: "alice" });
    const counters = legalMoves(db, s).counterCards;
    expect(counters).toContainEqual({ iid: stage, amount: 3000 });
    expect(counters.some((c) => c.iid === event)).toBe(false);
    const leader = s.players.alice.leaderIid;
    s = go(s, { type: "useCounter", player: "alice", cardIid: stage, targetIid: leader });
    expect(effectivePower(db, s, "alice", leader)).toBe(8000);
    expect(s.players.alice.zones.trash).toContain(stage);
  });

  it("without Franky a Stage in the hand is no counter", () => {
    let s = newGame();
    const stage = put(s, "STAGE", "hand");
    s = bobAttacksAlice(s);
    expect(legalMoves(db, s).counterCards.some((c) => c.iid === stage)).toBe(false);
    expect(() => applyIntent(db, s, { type: "useCounter", player: "alice", cardIid: stage, targetIid: s.players.alice.leaderIid })).toThrow(/no counter value/);
  });
});

describe("OP18-060 Saint Gunko: \"When a Character is played from your trash\"", () => {
  it("draws 2 and trashes 1 when an effect plays a Character from the trash", () => {
    let s = newGame("OP18-060");
    const reviver = put(s, "REVIVER"), dead = put(s, "DUCK", "trash");
    const hand = s.players.alice.zones.hand.length;
    s = go(s, { type: "activateMain", player: "alice", iid: reviver, effectIndex: 0 });
    // the only Character in the trash: no choice to make
    expect(s.players.alice.zones.characterArea).toContain(dead);
    expect(s.players.alice.zones.hand.length).toBe(hand + 2);
    expect(s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "alice", count: 1, upTo: false });
    s = go(s, { type: "respondTargets", player: "alice", iids: [s.players.alice.zones.hand[0]] });
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });

  it("does nothing when a Character is played from the hand", () => {
    let s = newGame("OP18-060");
    const duck = put(s, "DUCK", "hand");
    const hand = s.players.alice.zones.hand.length;
    s.players.alice.don.active = 5;
    markStateEdited(s);
    s = go(s, { type: "playCard", player: "alice", iid: duck });
    expect(s.pendingChoice).toBeNull();
    expect(s.players.alice.zones.hand.length).toBe(hand - 1);
  });
});

describe("OP18-061 Iceburg: \"up to a total of 2 Stage cards or {Water Seven} type cards\"", () => {
  it("offers the Stage and the {Water Seven} card among the 5 looked at, and takes both", () => {
    let s = newGame();
    const iceburg = put(s, "OP18-061", "hand");
    // top of the deck, last put = top
    put(s, "ANIMAL", "deck");
    const stage = put(s, "STAGE", "deck"), w7 = put(s, "W7", "deck");
    put(s, "EVENT", "deck"); put(s, "ALABASTA", "deck");
    s.players.alice.don.active = 5;
    markStateEdited(s);
    const hand = s.players.alice.zones.hand.length;
    s = go(s, { type: "playCard", player: "alice", iid: iceburg });
    const pc = s.pendingChoice;
    if (pc?.kind !== "peekSelect") throw new Error(`expected peekSelect, got ${pc?.kind}`);
    expect(pc.cards).toHaveLength(5);
    expect([...pc.eligible].sort()).toEqual([stage, w7].sort());
    expect(pc.takeCount).toBe(2);
    s = go(s, { type: "respondPeek", player: "alice", take: [stage, w7], restBottom: pc.cards.filter((iid) => iid !== stage && iid !== w7) });
    expect(s.players.alice.zones.hand).toEqual(expect.arrayContaining([stage, w7]));
    expect(s.players.alice.zones.hand.length).toBe(hand - 1 + 2);
  });
});

describe("OP18-105 Spandam: \"Activate the [Trigger] effect of the revealed card\"", () => {
  /** bob's Leader hits alice's Leader; her top Life card is Spandam and she activates its [Trigger]. */
  function spandamTrigger(leader: string, hand: string[]): { s: AutoGameState; spandam: string; held: string[] } {
    let s = newGame(leader);
    const spandam = put(s, "OP18-105", "life");
    const held = hand.map((id) => put(s, id, "hand"));
    s = bobAttacksAlice(s);
    if (s.pendingChoice?.kind === "counterWindow") s = go(s, { type: "passCounter", player: "alice" });
    expect(s.pendingChoice).toMatchObject({ kind: "triggerDecision", player: "alice", iid: spandam });
    s = go(s, { type: "respondTrigger", player: "alice", activate: true });
    return { s, spandam, held };
  }

  it("offers the {CP9} cards with a [Trigger], and the revealed card stays in the hand", () => {
    const start = spandamTrigger("L-CP9", ["CP-DRAW", "CP-PLAIN", "OTHER-TRIGGER", "OP18-105"]);
    let s = start.s;
    const [cpDraw] = start.held;
    expect(candidates(s)).toEqual([cpDraw]); // not the plain {CP9} card, the other type, or another [Spandam]
    const hand = s.players.alice.zones.hand.length;
    s = go(s, { type: "respondTargets", player: "alice", iids: [cpDraw] });
    expect(s.players.alice.zones.hand.length).toBe(hand + 1); // "Draw 1 card."
    expect(s.players.alice.zones.hand).toContain(cpDraw);
    expect(s.players.alice.zones.trash).toContain(start.spandam); // 10-1-5-3
    expect(s.pendingChoice?.kind).not.toBe("selectTargets");
  });

  it("\"Play this card\" plays the revealed card from the hand", () => {
    const start = spandamTrigger("L-CP9", ["CP-PLAY"]);
    let s = start.s;
    const [cpPlay] = start.held;
    s = go(s, { type: "respondTargets", player: "alice", iids: [cpPlay] });
    expect(s.players.alice.zones.characterArea).toContain(cpPlay);
    expect(s.players.alice.zones.hand).not.toContain(cpPlay);
    expect(s.players.alice.zones.trash).toContain(start.spandam);
  });

  it("is not offered without a Leader whose type includes \"CP\"", () => {
    let s = newGame("L");
    put(s, "OP18-105", "life");
    put(s, "CP-DRAW", "hand");
    s = bobAttacksAlice(s);
    if (s.pendingChoice?.kind === "counterWindow") s = go(s, { type: "passCounter", player: "alice" });
    expect(s.pendingChoice?.kind).not.toBe("triggerDecision");
  });
});

describe("OP18 review: what the first compile got wrong", () => {
  const setDon = (s: AutoGameState, active: number): void => { s.players.alice.don.active = active; markStateEdited(s); };
  const yes = (s: AutoGameState): AutoGameState => (s.pendingChoice?.kind === "mayActivate" ? go(s, { type: "respondMay", player: "alice", activate: true }) : s);

  it("a type including \"CP\" covers {CP6}: Leader and revealed card", () => {
    let s = newGame("L-CP6");
    const spandam = put(s, "OP18-105", "life"), cp6 = put(s, "CP6-DRAW", "hand");
    s = bobAttacksAlice(s);
    if (s.pendingChoice?.kind === "counterWindow") s = go(s, { type: "passCounter", player: "alice" });
    expect(s.pendingChoice).toMatchObject({ kind: "triggerDecision", iid: spandam });
    s = go(s, { type: "respondTrigger", player: "alice", activate: true });
    expect(candidates(s)).toEqual([cp6]);
  });

  it("OP18-020 pays with all the Life cards there are, not with ten", () => {
    let s = newGame("L-VIVI");
    const ev = put(s, "OP18-020", "hand");
    setDon(s, 5);
    const hand = s.players.alice.zones.hand.length, life = s.players.alice.zones.life.length;
    expect(life).toBeGreaterThan(0);
    s = bobAttacksAlice(s);
    expect(legalMoves(db, s).counterEvents.some((c) => c.iid === ev)).toBe(true);
    s = yes(go(s, { type: "useCounterEvent", player: "alice", cardIid: ev }));
    expect(s.players.alice.zones.life).toHaveLength(0);
    expect(s.players.alice.zones.hand.length).toBe(hand - 1 + life);
    expect(effectivePower(db, s, "bob", s.players.bob.leaderIid)).toBe(0);
  });

  it("OP18-117 Buster Call trashes all the Life cards and every Character", () => {
    let s = newGame("L-SPANDAM");
    const ev = put(s, "OP18-117", "hand");
    put(s, "DUCK"); put(s, "DUCK", "characterArea", "bob");
    setDon(s, 10);
    expect(legalMoves(db, s).playableFromHand.some((c) => c.iid === ev)).toBe(true);
    s = yes(go(s, { type: "playCard", player: "alice", iid: ev }));
    expect(s.players.alice.zones.life).toHaveLength(0);
    expect(s.players.alice.zones.characterArea).toHaveLength(0);
    expect(s.players.bob.zones.characterArea).toHaveLength(0);
  });

  it("OP18-058 [Trigger] asks for the [Main]'s cost: no Character to return, no effect", () => {
    const attacked = (withCharacter: boolean): AutoGameState => {
      let s = newGame();
      put(s, "OP18-058", "life");
      if (withCharacter) put(s, "DUCK");
      put(s, "DUCK", "characterArea", "bob");
      s = bobAttacksAlice(s);
      if (s.pendingChoice?.kind === "counterWindow") s = go(s, { type: "passCounter", player: "alice" });
      return s;
    };
    expect(attacked(false).pendingChoice?.kind).not.toBe("triggerDecision");
    let s = attacked(true);
    expect(s.pendingChoice).toMatchObject({ kind: "triggerDecision", player: "alice" });
    const mine = s.players.alice.zones.characterArea[0], theirs = s.players.bob.zones.characterArea[0];
    s = yes(go(s, { type: "respondTrigger", player: "alice", activate: true }));
    if (s.pendingChoice?.kind === "selectTargets" && candidates(s).includes(mine)) s = go(s, { type: "respondTargets", player: "alice", iids: [mine] });
    expect(s.players.alice.zones.hand).toContain(mine);
    if (s.pendingChoice?.kind === "selectTargets") s = go(s, { type: "respondTargets", player: "alice", iids: [theirs] });
    expect(s.players.bob.zones.characterArea).not.toContain(theirs);
    expect(s.players.bob.zones.deck[s.players.bob.zones.deck.length - 1] === theirs || s.players.bob.zones.deck[0] === theirs).toBe(true);
  });

  it("OP18-064 Killingham: the second Character is another one", () => {
    let s = newGame();
    const killingham = put(s, "OP18-064", "hand");
    const a = put(s, "SMALL-4000", "characterArea", "bob"), b = put(s, "SMALL-3000", "characterArea", "bob");
    setDon(s, 6);
    s = yes(go(s, { type: "playCard", player: "alice", iid: killingham }));
    if (s.pendingChoice?.kind === "payDon") s = go(s, { type: "respondPayDon", player: "alice", fromActive: 0, fromRested: 1, fromGiven: {} });
    expect(candidates(s)).toEqual([a, b].sort()); // 7000 base power or less
    s = go(s, { type: "respondTargets", player: "alice", iids: [a] });
    expect(candidates(s)).toEqual([b]); // 5000 base power or less, and not the first one
  });

  it("OP18-019 Quack!!! does nothing with a Character of 7000 base power", () => {
    const playable = (withBig: boolean): boolean => {
      const s = newGame();
      const ev = put(s, "OP18-019", "hand");
      if (withBig) put(s, "BIG");
      put(s, "DUCK", "characterArea", "bob");
      setDon(s, 5);
      return legalMoves(db, s).playableFromHand.some((c) => c.iid === ev);
    };
    expect(playable(false)).toBe(true);
    expect(playable(true)).toBe(false);
  });

  it("OP18-080 Van Augur draws when the [Marshall.D.Teach] Leader trashes a card, not when another card does", () => {
    const afterTrash = (by: "leader" | "character"): number => {
      let s = newGame("OP09-081");
      put(s, "OP18-080");
      const discarder = put(s, "DISCARDER");
      const hand = s.players.alice.zones.hand.length;
      s = by === "leader"
        ? go(s, { type: "activateMain", player: "alice", iid: s.players.alice.leaderIid, effectIndex: 1 })
        : go(s, { type: "activateMain", player: "alice", iid: discarder, effectIndex: 0 });
      s = yes(s);
      if (s.pendingChoice?.kind === "selectTargets") s = go(s, { type: "respondTargets", player: "alice", iids: [s.players.alice.zones.hand[0]] });
      return s.players.alice.zones.hand.length - hand;
    };
    expect(afterTrash("leader")).toBe(0);     // −1 trashed, +1 from Van Augur
    expect(afterTrash("character")).toBe(0);  // −1 trashed, +1 from the card's own "Draw 1 card", none from Van Augur
  });

  it("OP18-117 Buster Call then plays {Vice Admiral} Characters with different names from the deck or the trash", () => {
    let s = newGame("L-SPANDAM");
    const ev = put(s, "OP18-117", "hand");
    const momonga = put(s, "VA-MOMONGA", "deck"), twin = put(s, "VA-MOMONGA", "deck"), onigumo = put(s, "VA-ONIGUMO", "deck");
    const doberman = put(s, "VA-DOBERMAN", "trash");
    put(s, "DUCK", "trash"); // not a {Vice Admiral}
    const mine = put(s, "DUCK");
    setDon(s, 10);
    s = yes(go(s, { type: "playCard", player: "alice", iid: ev }));
    expect(candidates(s)).toEqual([momonga, twin, onigumo, doberman].sort());
    expect(() => applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [momonga, twin] })).toThrow(); // the same name twice
    const deck = s.players.alice.zones.deck.length;
    s = go(s, { type: "respondTargets", player: "alice", iids: [momonga, onigumo, doberman] });
    const alice = s.players.alice.zones;
    expect([...alice.characterArea].sort()).toEqual([momonga, onigumo, doberman].sort());
    expect(alice.deck).toHaveLength(deck - 2);
    expect(alice.deck).toContain(twin);
    expect(alice.trash).toContain(mine); // "trash all Characters" came first
    expect(alice.trash).not.toContain(doberman);
    expect(s.pendingChoice).toBeNull();
  });
});
