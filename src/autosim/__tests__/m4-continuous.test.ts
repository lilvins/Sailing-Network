import { describe, expect, it } from "vitest";
import type { Effect, Keyword, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { isAutomaticStatic, staticModifiers } from "../engine/continuous";
import {
  effectiveCost, effectivePower, hasRestriction, keywordsOf,
  type AutoGameState, type CardDb, type EngineCard, type PID,
} from "../engine/state";

/**
 * M4 — continuous effects (8-1-3-3). `static` effects of cards on the field
 * are recomputed on every query, with their conditions, to a fixpoint
 * (8-1-3-3-5); they start and stop with their card and conditions.
 */

const CARDS: Record<string, EngineCard> = {};
const sel = (owner: Selector["owner"], zone: Selector["zone"], extra: Partial<Selector> = {}): Selector =>
  ({ owner, zone, count: 1, chooser: "controller", ...extra });
const all = (owner: Selector["owner"], zone: Selector["zone"], extra: Partial<Selector> = {}) => sel(owner, zone, { count: 99, ...extra });
const self = (zone: Selector["zone"] = "characterArea") => sel("self", zone, { self: true });

function addCard(id: string, o: { cat?: EngineCard["category"]; cost: number; power?: number; keywords?: Keyword[]; effects?: Effect[] }): void {
  CARDS[id] = {
    id, category: o.cat ?? "Character", cost: o.cost, power: o.power ?? 1000, counter: 1000,
    colors: ["Red"], types: ["M4"], name: id,
    compiled: o.effects || o.keywords ? {
      cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: o.keywords ?? [], effects: o.effects ?? [],
    } : undefined,
  };
}

// Leader: [Your Turn] all of your Characters gain +1000 power.
addCard("SL-AURA", { cat: "Leader", cost: 5, power: 5000, effects: [
  { timing: "static", conditions: [{ kind: "yourTurn" }], actions: [{ kind: "powerMod", sel: all("self", "characterArea"), amount: 1000, duration: "permanentWhileInPlay" }] },
]});
addCard("SL-PLAIN", { cat: "Leader", cost: 5, power: 5000 });
// [DON!! x1] This Character gains [Blocker].
addCard("SC-DONBLK", { cost: 2, power: 3000, effects: [
  { timing: "static", conditions: [{ kind: "donAttached", count: 1 }], actions: [{ kind: "grantKeyword", sel: self(), keyword: "Blocker", duration: "permanentWhileInPlay" }] },
]});
addCard("SC-BIG", { cost: 5, power: 6000 });
// If you have another Character with 7000 power or more, this Character gains +2000 power.
addCard("SC-GATE", { cost: 3, power: 4000, effects: [
  { timing: "static", conditions: [{ kind: "countInZone", sel: all("self", "characterArea", { filter: { powerAtLeast: 7000, excludeSelf: true } }), atLeast: 1 }],
    actions: [{ kind: "powerMod", sel: self(), amount: 2000, duration: "permanentWhileInPlay" }] },
]});
// Your opponent's Characters cost 2 more.
addCard("SC-TAX", { cost: 4, power: 5000, effects: [
  { timing: "static", actions: [{ kind: "costMod", sel: all("opponent", "characterArea"), amount: 2, duration: "permanentWhileInPlay" }] },
]});
// This Character cannot attack.
addCard("SC-WALL", { cost: 2, power: 5000, effects: [
  { timing: "static", actions: [{ kind: "restriction", sel: self(), what: "cannotAttack", duration: "permanentWhileInPlay" }] },
]});
for (let i = 1; i <= 8; i++) addCard(`SC-V${i}`, { cost: 1, power: 2000 });

const db: CardDb = (id) => {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};

const DECK = [
  ...["SC-DONBLK", "SC-BIG", "SC-GATE", "SC-TAX", "SC-WALL", "SC-V1", "SC-V2", "SC-V3", "SC-V4", "SC-V5", "SC-V6", "SC-V7"].flatMap((id) => Array<string>(4).fill(id)),
  "SC-V8", "SC-V8",
];

function newGame(leaderA = "SL-AURA"): AutoGameState {
  const config: GameConfig = {
    seed: "m4-seed",
    players: [{ id: "alice", leader: leaderA, deck: DECK }, { id: "bob", leader: "SL-PLAIN", deck: DECK }],
    firstPlayer: "alice",
  };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}

/** Put a copy of `cardId` from the deck/hand straight onto the field (test setup). */
function put(s: AutoGameState, pid: PID, cardId: string): string {
  const p = s.players[pid];
  for (const zone of ["deck", "hand"] as const) {
    const i = p.zones[zone].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) {
      const [iid] = p.zones[zone].splice(i, 1);
      p.zones.characterArea.push(iid);
      p.instances[iid].rested = false;
      return iid;
    }
  }
  throw new Error(`no ${cardId} left for ${pid}`);
}

function removeFromField(s: AutoGameState, pid: PID, iid: string): void {
  const p = s.players[pid];
  p.zones.characterArea = p.zones.characterArea.filter((x) => x !== iid);
  p.zones.trash.push(iid);
}

describe("M4 continuous effects", () => {
  it("an aura applies to every Character of its owner, only while its condition holds", () => {
    const s = newGame();
    const v = put(s, "alice", "SC-V1");
    expect(s.turnPlayer).toBe("alice");
    expect(effectivePower(db, s, "alice", v)).toBe(3000);
    s.turnPlayer = "bob"; // [Your Turn] no longer true
    expect(effectivePower(db, s, "alice", v)).toBe(2000);
    // the opponent's Characters are not affected
    s.turnPlayer = "alice";
    const bv = put(s, "bob", "SC-V1");
    expect(effectivePower(db, s, "bob", bv)).toBe(2000);
  });

  it("[DON!! x1] gains [Blocker] only with a DON!! given", () => {
    const s = newGame();
    const c = put(s, "alice", "SC-DONBLK");
    expect(keywordsOf(db, s, "alice", c).has("Blocker")).toBe(false);
    s.players.alice.don.given[c] = 1;
    expect(keywordsOf(db, s, "alice", c).has("Blocker")).toBe(true);
  });

  it("conditions that depend on other continuous effects reach a fixpoint (8-1-3-3-5)", () => {
    const s = newGame();
    const big = put(s, "alice", "SC-BIG"); // 6000 base, 7000 with the aura on alice's turn
    const gate = put(s, "alice", "SC-GATE");
    expect(effectivePower(db, s, "alice", big)).toBe(7000);
    expect(effectivePower(db, s, "alice", gate)).toBe(4000 + 1000 + 2000);
    s.turnPlayer = "bob"; // aura off → BIG is 6000 → the gate closes too
    expect(effectivePower(db, s, "alice", gate)).toBe(4000);
  });

  it("effects end when their card leaves the field", () => {
    const s = newGame();
    const big = put(s, "alice", "SC-BIG");
    const gate = put(s, "alice", "SC-GATE");
    expect(effectivePower(db, s, "alice", gate)).toBe(7000);
    removeFromField(s, "alice", big);
    expect(effectivePower(db, s, "alice", gate)).toBe(5000);
    expect(staticModifiers(db, s).some((m) => m.source === big)).toBe(false);
  });

  it("cost changes and restrictions apply continuously", () => {
    const s = newGame("SL-PLAIN");
    put(s, "alice", "SC-TAX");
    const target = put(s, "bob", "SC-V1");
    expect(effectiveCost(db, s, "bob", target)).toBe(3);
    const wall = put(s, "alice", "SC-WALL");
    expect(hasRestriction(db, s, "alice", wall, "cannotAttack")).toBe(true);
    expect(hasRestriction(db, s, "alice", target, "cannotAttack")).toBe(false);
  });

  it("static effects are not stored: the state's modifier list stays empty", () => {
    const s = newGame();
    put(s, "alice", "SC-V1");
    expect(s.modifiers.length).toBe(0);
    expect(staticModifiers(db, s).length).toBeGreaterThan(0);
  });

  it("board-auto transparency: which static effects now run", () => {
    expect(isAutomaticStatic(CARDS["SC-GATE"].compiled!.effects[0])).toBe(true);
    expect(isAutomaticStatic({ timing: "static", actions: [{ kind: "manual", text: "x" }] })).toBe(false);
  });
});
