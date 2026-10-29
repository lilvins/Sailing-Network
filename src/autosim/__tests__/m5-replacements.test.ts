import { describe, expect, it } from "vitest";
import type { Effect, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard, type PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 replacement effects (8-1-3-4): "If [this / your] Character would be
 * K.O.'d / removed (by your opponent's effect), you may [X] instead."
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
addCard("A-BIG", null, { category: "Leader", cost: 5, power: 9000 });
// If this Character would be K.O.'d, you may return 1 DON!! instead.
addCard("C-SELF", [{ timing: "replacement", optional: true, replaces: { events: ["koBattle", "koEffect"], subject: "self" }, actions: [], cost: [{ kind: "returnDonToDeck", count: 1 }] }]);
// [Once Per Turn] If your {Navy} Character would be removed by your opponent's effect, give your Leader −2000 instead.
addCard("C-ALLY", [{ timing: "replacement", optional: true, oncePerTurn: true,
  replaces: { events: ["koEffect", "bounce"], subject: "ally", filter: { typeIncludes: ["Navy"] }, byOpponent: true }, actions: [],
  cost: [{ kind: "action", action: { kind: "powerMod", sel: sel("self", "leader", 1), amount: -2000, duration: "thisTurn" } }] }]);
addCard("C-NAVY", null, { types: ["Navy"] });
addCard("C-KO", [{ timing: "activateMain", actions: [{ kind: "koTarget", sel: sel("opponent", "characterArea", 99) }] }]);
for (let i = 1; i <= 7; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
for (let i = 8; i <= 13; i++) addCard(`V${i}`, null);
// 11 cards × 4 + 6 singles = 50
const DECK = ["C-SELF", "C-ALLY", "C-NAVY", "C-KO", "V1", "V2", "V3", "V4", "V5", "V6", "V7"].flatMap((id) => Array<string>(4).fill(id))
  .concat("V8", "V9", "V10", "V11", "V12", "V13");
function newGame(leaderA = "L"): AutoGameState {
  const deck = DECK;
  const config: GameConfig = { seed: "m5rep", firstPlayer: "alice", players: [{ id: "alice", leader: leaderA, deck }, { id: "bob", leader: "L", deck }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones.characterArea.push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const act = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 }).state;

describe("M5 replacement effects", () => {
  it("\"would be K.O.'d by an effect → return 1 DON!! instead\": yes keeps it, no lets it go", () => {
    let s = newGame();
    const keep = put(s, "C-SELF", "bob");
    s.players.bob.don.active = 2;
    s = act(s, put(s, "C-KO"));
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", player: "bob", targetIid: keep });
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    expect(s.players.bob.zones.characterArea).toContain(keep);
    expect(s.players.bob.don.active).toBe(1);

    let t = newGame();
    const gone = put(t, "C-SELF", "bob");
    t.players.bob.don.active = 2;
    t = act(t, put(t, "C-KO"));
    t = applyIntent(db, t, { type: "respondReplace", player: "bob", use: false }).state;
    expect(t.players.bob.zones.trash).toContain(gone);
  });

  it("protects an ally only against the opponent's effects, once per turn; no DON!! → not offered", () => {
    let s = newGame();
    put(s, "C-ALLY", "bob");
    const n1 = put(s, "C-NAVY", "bob"), n2 = put(s, "C-NAVY", "bob");
    s = act(s, put(s, "C-KO")); // K.O. all of bob's Characters
    expect(s.pendingChoice?.kind).toBe("mayReplace");
    const first = s.pendingChoice!.kind === "mayReplace" ? s.pendingChoice!.targetIid : "";
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    // [Once Per Turn]: the second Navy is not offered again
    expect(s.pendingChoice).toBeNull();
    const saved = [n1, n2].filter((x) => s.players.bob.zones.characterArea.includes(x));
    expect(saved).toEqual([first]);
    expect(effectivePower(db, s, "bob", s.players.bob.leaderIid)).toBe(3000);
  });

  it("a battle K.O. can be replaced too (\"would be K.O.'d\")", () => {
    let s = newGame("A-BIG");
    const keep = put(s, "C-SELF", "bob");
    s.players.bob.instances[keep].rested = true;
    s.players.bob.don.active = 1;
    s.turn = 3;
    s = applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: keep }).state;
    let guard = 20;
    while (s.pendingChoice && s.pendingChoice.kind !== "mayReplace" && guard-- > 0) {
      const pc = s.pendingChoice;
      if (pc.kind === "blockWindow") s = applyIntent(db, s, { type: "respondBlock", player: pc.player, blockerIid: null }).state;
      else if (pc.kind === "counterWindow") s = applyIntent(db, s, { type: "passCounter", player: pc.player }).state;
      else break;
    }
    expect(s.pendingChoice).toMatchObject({ kind: "mayReplace", battle: true });
    s = applyIntent(db, s, { type: "respondReplace", player: "bob", use: true }).state;
    expect(s.players.bob.zones.characterArea).toContain(keep);
    expect(s.battle).toBeNull();
  });
});

describe("M5 compiler: replacements", () => {
  it("Zoro OP17-095: \"if one of your Characters would be removed by your opponent's effect, place 3 cards from your trash at the bottom instead\"", () => {
    const fx = getGeneratedCard("OP17-095")!.effects.find((e) => e.timing === "replacement")!;
    expect(fx.replaces).toMatchObject({ subject: "ally", byOpponent: true });
    expect(fx.cost).toMatchObject([{ kind: "action", action: { kind: "returnToDeck", sel: { zone: "trash", count: 3 } } }]);
  });
});
