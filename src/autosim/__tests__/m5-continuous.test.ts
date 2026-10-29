import { describe, expect, it } from "vitest";
import type { Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { actionCandidates } from "../engine/effects";
import { effectiveBasePower, effectiveCost, effectivePower, keywordsOf, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 continuous effects: "this card in your hand costs −N", immunity to your
 * opponent's effects (K.O. / removal / rest), "base power becomes N",
 * "+1000 for every N cards in your trash", field-wide keywords.
 */

const CARDS: Record<string, EngineCard> = {};
const P = "permanentWhileInPlay" as const;
const sel = (owner: Selector["owner"], zone: Selector["zone"], extra: Partial<Selector> = {}): Selector => ({ owner, zone, count: 99, chooser: "controller", ...extra });
const self = (zone: Selector["zone"] = "characterArea"): Selector => ({ owner: "self", zone, count: 1, self: true, chooser: "controller" });
function addCard(id: string, effects: Effect[] | null, o: Partial<EngineCard> = {}): void {
  CARDS[id] = {
    id, category: "Character", cost: 4, power: 3000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    compiled: effects ? { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects } : undefined,
  } as EngineCard;
}
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-HANDCOST", [{ timing: "static", conditions: [{ kind: "lifeAtMost", who: "self", count: 3 }], actions: [{ kind: "costMod", sel: self("hand"), amount: -2, duration: P }] }]);
addCard("C-IMMUNE", [{ timing: "static", actions: [{ kind: "restriction", sel: self(), what: "cannotBeKOdByOpponent", duration: P }] }]);
addCard("C-NOREMOVE", [{ timing: "static", actions: [{ kind: "restriction", sel: self(), what: "cannotBeRemovedByOpponent", duration: P }] }]);
addCard("C-BASE", [{ timing: "static", actions: [{ kind: "setBasePower", sel: sel("self", "characterArea", { filter: { typeIncludes: ["Ohm"] } }), amount: 6000, duration: P }] }]);
addCard("C-OHM", null, { types: ["Ohm"], power: 2000 });
addCard("C-SCALE", [{ timing: "static", actions: [{ kind: "powerMod", sel: self(), amount: 1000, duration: P, scale: { q: { count: "trash", who: "self" }, per: 5 } }] }]);
addCard("C-AURA", [{ timing: "static", actions: [{ kind: "grantKeyword", sel: sel("self", "characterArea", { filter: { excludeSelf: true } }), keyword: "Blocker", duration: P }] }]);
for (let i = 1; i <= 7; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-HANDCOST", "C-IMMUNE", "C-NOREMOVE", "C-BASE", "C-OHM", "C-SCALE", "C-AURA", "V1", "V2", "V3", "V4", "V5"]
  .flatMap((id) => Array<string>(4).fill(id)).concat("V6", "V7");
function newGame(): AutoGameState {
  const config: GameConfig = { seed: "m5c", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "hand" | "trash" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const ko = (owner: Selector["owner"]) => ({ kind: "koTarget" as const, sel: sel(owner, "characterArea") });

describe("M5 continuous", () => {
  it("\"this card in your hand costs −2\" while the condition holds", () => {
    const s = newGame();
    const c = put(s, "C-HANDCOST", "alice", "hand");
    expect(effectiveCost(db, s, "alice", c)).toBe(4);
    s.players.alice.zones.life.splice(3);
    expect(effectiveCost(db, s, "alice", c)).toBe(2);
  });

  it("\"cannot be K.O.'d by your opponent's effects\" / \"cannot be removed …\" only stop the opponent", () => {
    const s = newGame();
    const a = put(s, "C-IMMUNE", "bob"), b = put(s, "C-NOREMOVE", "bob");
    const fromAlice = actionCandidates(db, s, "alice", s.players.alice.leaderIid, ko("opponent")).map((t) => t.iid);
    expect(fromAlice).not.toContain(a);
    expect(fromAlice).not.toContain(b);
    const fromBob = actionCandidates(db, s, "bob", s.players.bob.leaderIid, ko("self")).map((t) => t.iid);
    expect(fromBob).toContain(a);
    expect(fromBob).toContain(b);
    const bounce = actionCandidates(db, s, "alice", s.players.alice.leaderIid, { kind: "returnToHand", sel: sel("opponent", "characterArea") }).map((t) => t.iid);
    expect(bounce).toContain(a);
    expect(bounce).not.toContain(b);
  });

  it("\"base power becomes 6000\" sets the base the modifiers add to", () => {
    const s = newGame();
    put(s, "C-BASE");
    const ohm = put(s, "C-OHM");
    expect(effectiveBasePower(db, s, "alice", ohm)).toBe(6000);
    expect(effectivePower(db, s, "alice", ohm)).toBe(6000);
  });

  it("\"+1000 for every 5 cards in your trash\" and keywords granted to the field", () => {
    const s = newGame();
    const c = put(s, "C-SCALE");
    for (let i = 0; i < 11; i++) s.players.alice.zones.trash.push(s.players.alice.zones.deck.shift()!);
    expect(effectivePower(db, s, "alice", c)).toBe(3000 + 2000);
    put(s, "C-AURA");
    expect(keywordsOf(db, s, "alice", c).has("Blocker")).toBe(true);
  });
});

describe("M5 compiler: continuous", () => {
  it("OP17-112 Linlin: [Your Turn] base power of your [Trigger] 4000 Characters becomes 8000", () => {
    const fx = getGeneratedCard("OP17-112")!.effects.find((e) => e.timing === "static")!;
    expect(fx.actions[0]).toMatchObject({ kind: "setBasePower", amount: 8000 });
  });
  it("OP03-008: cannot be K.O.'d in battle by <Slash> attribute cards", () => {
    const fx = getGeneratedCard("OP03-008")!.effects.find((e) => e.timing === "static")!;
    expect(fx.actions[0]).toMatchObject({ kind: "restriction", what: "cannotBeKOdInBattle", attributes: ["Slash"] });
  });
});
