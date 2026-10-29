import { describe, expect, it } from "vitest";
import type { Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { matchesFilter, resolveSelector } from "../engine/effects";
import type { AutoGameState, CardDb, EngineCard, PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 targets: "… or [Name] / or Event", "cost ≤ your opponent's Life",
 * "given DON!!", "no base effect", "without an [On Play]", set constraints
 * ("total cost of N or less"), Leader-or-Stage zones, and the compiler side.
 */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, o: Partial<EngineCard> = {}): void {
  CARDS[id] = { id, category: "Character", cost: 2, power: 3000, counter: 1000, colors: ["Red"], types: ["Navy"], name: id, hasEffect: false, ...o } as EngineCard;
}
addCard("L", { category: "Leader", cost: 5, power: 5000 });
addCard("SANJI", { name: "Sanji", types: ["Straw Hat Crew"], cost: 4, hasEffect: true });
addCard("EVT", { category: "Event", cost: 1, power: null });
addCard("ONPLAY", { cost: 3, hasEffect: true, compiled: {
  cardId: "ONPLAY", version: 1, confidence: 1, classification: "compiled", keywords: [],
  effects: [{ timing: "onPlay", actions: [{ kind: "draw", count: 1 }] }],
} });
addCard("STAGE", { category: "Stage", cost: 1, power: null, types: ["Dressrosa"] });
for (let i = 1; i <= 10; i++) addCard(`V${i}`, { cost: i % 4 + 1 });

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["SANJI", "EVT", "ONPLAY", "STAGE", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"].flatMap((id) => Array<string>(4).fill(id)).concat("V9", "V10");

function newGame(): AutoGameState {
  const config: GameConfig = { seed: "m5t", firstPlayer: "alice", players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }] };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}
function put(s: AutoGameState, cardId: string, pid: PID = "alice", zone: "characterArea" | "stage" | "hand" = "characterArea"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) { const [iid] = p.zones[from].splice(i, 1); p.zones[zone].push(iid); return iid; }
  }
  throw new Error(`no ${cardId}`);
}
const sel = (owner: Selector["owner"], zone: Selector["zone"], extra: Partial<Selector> = {}): Selector => ({ owner, zone, count: 99, chooser: "controller", ...extra });

describe("M5 target filters", () => {
  it("\"[Sanji] or Event\": a card matching the or-filter matches", () => {
    const s = newGame();
    const sanji = put(s, "SANJI", "alice", "hand"), evt = put(s, "EVT", "alice", "hand"), v = put(s, "V1", "alice", "hand");
    const f = { category: ["Event" as const], or: { nameIncludes: ["Sanji"] } };
    const hits = resolveSelector(db, s, "alice", s.players.alice.leaderIid, sel("self", "hand", { filter: f })).map((t) => t.iid);
    expect(hits).toContain(sanji);
    expect(hits).toContain(evt);
    expect(hits).not.toContain(v);
  });

  it("cost ≤ the opponent's Life, given DON!!, no base effect, without [On Play]", () => {
    const s = newGame();
    const leader = s.players.alice.leaderIid;
    const big = put(s, "SANJI", "bob"); // cost 4
    const plain = put(s, "V1", "bob");  // vanilla
    const op = put(s, "ONPLAY", "bob");
    s.players.bob.zones.life.splice(3); // bob has 3 Life
    const life = { costAtMostQ: { count: "life" as const, who: "opponent" as const } };
    expect(matchesFilter(db, s, "bob", big, life, leader, true)).toBe(false);
    s.players.bob.zones.life.push(s.players.bob.zones.deck.shift()!);
    expect(matchesFilter(db, s, "bob", big, life, leader, true)).toBe(true);
    expect(matchesFilter(db, s, "bob", plain, { donGivenAtLeast: 1 }, leader, true)).toBe(false);
    s.players.bob.don.given[plain] = 1;
    expect(matchesFilter(db, s, "bob", plain, { donGivenAtLeast: 1 }, leader, true)).toBe(true);
    expect(matchesFilter(db, s, "bob", plain, { noBaseEffect: true }, leader, true)).toBe(true);
    expect(matchesFilter(db, s, "bob", big, { noBaseEffect: true }, leader, true)).toBe(false);
    expect(matchesFilter(db, s, "bob", op, { lacksTiming: "onPlay" }, leader, true)).toBe(false);
    expect(matchesFilter(db, s, "bob", plain, { lacksTiming: "onPlay" }, leader, true)).toBe(true);
  });

  it("Leader-or-Stage zone", () => {
    const s = newGame();
    const st = put(s, "STAGE", "alice", "stage");
    const hits = resolveSelector(db, s, "alice", s.players.alice.leaderIid, sel("self", "leaderOrStage")).map((t) => t.iid);
    expect(hits.sort()).toEqual([s.players.alice.leaderIid, st].sort());
  });
});

describe("M5 compiler: targets", () => {
  it("\"K.O. your opponent's Characters with a total cost of 4 or less\" (Loki OP17-119) carries a set limit", () => {
    const fx = getGeneratedCard("OP17-119")!.effects.find((e) => e.timing === "onPlay")!;
    expect(fx.actions[0]).toMatchObject({ kind: "koTarget", sel: { totalCostAtMost: 4 } });
  });

  it("\"rest 1 of your cards:\" → rest a DON!! or a Leader/Character/Stage (EB04-015)", () => {
    const fx = getGeneratedCard("EB04-015")!.effects.find((e) => e.cost)!;
    expect(fx.cost![0]).toMatchObject({ kind: "oneOf", options: [[{ kind: "restDon", count: 1 }], [{ kind: "action", action: { kind: "restTarget", sel: { zone: "field" } } }]] });
  });

  it("Teach OP16-119: look at 3, add up to 1 to the top of your Life", () => {
    const fx = getGeneratedCard("OP16-119")!.effects[0];
    expect(fx.actions[0]).toMatchObject({ kind: "peekDeck", count: 3, then: { lifeCount: 1, rest: "bottomAnyOrder" } });
  });

  it("\"cost ≤ your opponent's Life\" only when the text says so (OP05-102)", () => {
    const fx = getGeneratedCard("OP05-102")!.effects[0];
    expect(JSON.stringify(fx.actions)).toContain("costAtMostQ");
  });
});
