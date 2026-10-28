// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Effect, Keyword, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { PlayerIntent } from "../engine/intents";
import type { GameEvent } from "../engine/events";
import {
  effectivePower, hasRestriction, keywordsOf,
  type AutoGameState, type CardDb, type EngineCard, type PID,
} from "../engine/state";
import { legalMoves } from "../engine/legality";
import { coverage, getCompiledCard } from "../data/compiled";

/**
 * M3 test suite (AUTOSIM_PLAN.md §8 M3): tier-2 executor (peek/search, play
 * from zone, bounce, life/DON manipulation, mill), the [Activate: Main]
 * intent (10-2-2), cost payment with choices (8-3-1), DON!!−X composition
 * (8-3-1-6), "that card" binding, draw up to N, and the End Phase /
 * end-of-battle enqueue points (6-6-1, 7-1-5-2).
 *
 * Exit criteria covered here: ST01-001's leader ability end-to-end via
 * intents, and Nami OP01-016's search end-to-end through the peekSelect
 * ChoiceRequest (rest to the bottom in the chosen order).
 */

// ─── synthetic card DB ───────────────────────────────────────────────────────

const CARDS: Record<string, EngineCard> = {};
const sel = (owner: Selector["owner"], zone: Selector["zone"], extra: Partial<Selector> = {}): Selector =>
  ({ owner, zone, count: 1, chooser: "controller", ...extra });

function addCard(id: string, opts: {
  cat?: EngineCard["category"]; cost: number; power?: number | null; counter?: number | null;
  keywords?: Keyword[]; effects?: Effect[];
}): void {
  const hasIR = (opts.keywords?.length ?? 0) > 0 || (opts.effects?.length ?? 0) > 0;
  CARDS[id] = {
    id, category: opts.cat ?? "Character", cost: opts.cost,
    power: opts.power ?? null, counter: opts.counter ?? null,
    colors: ["Red"], types: ["M3"], name: id,
    compiled: hasIR ? {
      cardId: "TEST-000", version: 1, confidence: 1,
      classification: (opts.effects?.length ?? 0) > 0 ? "compiled" : "keyword-only",
      keywords: opts.keywords ?? [], effects: opts.effects ?? [],
    } : undefined,
  };
}

addCard("NL-A", { cat: "Leader", cost: 4, power: 5000 });
addCard("NL-B", { cat: "Leader", cost: 4, power: 5000 });
CARDS["NL-B"].colors = ["Blue", "Red"];

addCard("NC-AMDRAW", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "activateMain", oncePerTurn: true, cost: [{ kind: "restDon", count: 1 }],
    actions: [{ kind: "draw", count: 1 }] },
]});
addCard("NC-PAYDON", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "activateMain", cost: [{ kind: "returnDonToDeck", count: 2 }],
    actions: [{ kind: "draw", count: 1 }] },
]});
addCard("NC-UPTO", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "activateMain", actions: [{ kind: "draw", count: 2, upTo: true }] },
]});
addCard("NC-PREV", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "standTarget", sel: sel("self", "characterArea", { filter: { rested: true }, upTo: true }) },
    { kind: "powerMod", amount: 2000, duration: "thisTurn", sel: sel("self", "characterArea", { prev: true }) },
  ]},
]});
addCard("NC-SCRY", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "onPlay", actions: [
    { kind: "peekDeck", who: "self", count: 3, then: { rest: "topOrBottomAnyOrder" } },
  ]},
]});
addCard("NC-EOT", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "endOfYourTurn", actions: [{ kind: "draw", count: 1 }] },
]});
addCard("NC-EOOT", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "endOfOpponentsTurn", actions: [{ kind: "draw", count: 1 }] },
]});
addCard("NC-EOB", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "endOfBattle", actions: [{ kind: "draw", count: 1 }] },
]});
addCard("NC-PLAYH", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "playFromZone", zone: "hand", free: true,
      sel: sel("self", "hand", { filter: { category: ["Character"], costAtMost: 1 }, upTo: true }) },
  ]},
]});
addCard("NC-BOUNCE", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "returnToHand", sel: sel("opponent", "characterArea", { upTo: true }) },
  ]},
]});
addCard("NC-DECKB", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "returnToDeck", where: "bottom", sel: sel("opponent", "characterArea", { upTo: true }) },
  ]},
]});
addCard("NC-MILL", { cost: 1, power: 2000, effects: [
  { timing: "onPlay", actions: [{ kind: "mill", who: "opponent", count: 2 }] },
]});
addCard("NC-L2H", { cost: 1, power: 3000, effects: [
  { timing: "onPlay", optional: true, cost: [{ kind: "lifeToHand", count: 1 }],
    actions: [
      { kind: "grantKeyword", keyword: "Rush", duration: "thisTurn", sel: sel("self", "characterArea", { self: true }) },
    ] },
]});
addCard("NC-TFH", { cost: 1, power: 2000, effects: [
  { timing: "activateMain", cost: [{ kind: "trashFromHand", sel: sel("self", "hand") }],
    actions: [{ kind: "draw", count: 1 }] },
]});
addCard("NC-ATH", { cost: 1, power: 2000, effects: [
  { timing: "onPlay", actions: [
    { kind: "addFromTrashToHand", sel: sel("self", "trash", { filter: { category: ["Character"] }, upTo: true }) },
  ]},
]});
addCard("NC-STANDDON", { cost: 1, power: 2000, effects: [
  { timing: "activateMain", actions: [{ kind: "standDon", count: 2 }] },
]});
addCard("NC-CANATK", { cost: 1, power: 2000, effects: [
  { timing: "onPlay", actions: [
    { kind: "restriction", what: "canAttackActiveCharacters", duration: "thisTurn",
      sel: sel("self", "characterArea", { filter: { excludeSelf: true }, upTo: true }) },
  ]},
]});
for (let i = 1; i <= 13; i++) {
  addCard(`NV-${String(i).padStart(2, "0")}`, { cost: 1, power: 2000, counter: 1000 });
}

const db: CardDb = (id) => {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};

function deckOf(entries: [string, number][]): string[] {
  const d = entries.flatMap(([id, n]) => Array<string>(n).fill(id));
  if (d.length !== 50) throw new Error(`deck has ${d.length} cards`);
  return d;
}
const nv = (n: number): [string, number][] =>
  Array.from({ length: n }, (_, i) => [`NV-${String(i + 1).padStart(2, "0")}`, 4] as [string, number]);

const M3_DECK = deckOf([
  ["NC-AMDRAW", 4], ["NC-PAYDON", 4], ["NC-UPTO", 4], ["NC-PREV", 4], ["NC-SCRY", 2],
  ["NC-PLAYH", 4], ["NC-BOUNCE", 4], ["NC-DECKB", 2], ["NC-MILL", 2], ["NC-L2H", 4],
  ["NC-TFH", 4], ["NC-ATH", 2], ["NC-STANDDON", 2], ["NC-CANATK", 4], ["NV-01", 4],
]);
const EO_DECK = deckOf([["NC-EOT", 4], ["NC-EOOT", 4], ["NC-EOB", 4], ...nv(9), ["NV-10", 2]]);
const VAN_DECK = deckOf([...nv(12), ["NV-13", 2]]);

// ─── harness (m1-style) ──────────────────────────────────────────────────────

interface Ctx { s: AutoGameState; log: GameEvent[]; db: CardDb }

function run(ctx: Ctx, intents: PlayerIntent[]): GameEvent[] {
  const emitted: GameEvent[] = [];
  for (const intent of intents) {
    const r = applyIntent(ctx.db, ctx.s, intent);
    ctx.s = r.state;
    ctx.log.push(...r.events);
    emitted.push(...r.events);
  }
  return emitted;
}

function newCtx(deckA: string[], deckB: string[], cardDb: CardDb = db, opts: { seed?: string; leaderA?: string; leaderB?: string } = {}): Ctx {
  const config: GameConfig = {
    seed: opts.seed ?? "m3-seed",
    players: [
      { id: "alice", leader: opts.leaderA ?? "NL-A", deck: deckA },
      { id: "bob", leader: opts.leaderB ?? "NL-B", deck: deckB },
    ],
    firstPlayer: "alice",
  };
  const { state, events } = createGame(cardDb, config);
  const ctx: Ctx = { s: state, log: [...events], db: cardDb };
  run(ctx, [
    { type: "respondMulligan", player: "alice", take: false },
    { type: "respondMulligan", player: "bob", take: false },
  ]);
  return ctx;
}

const handIid = (ctx: Ctx, pid: PID, cardId: string) =>
  ctx.s.players[pid].zones.hand.find((iid) => ctx.s.players[pid].instances[iid].cardId === cardId);

function until(ctx: Ctx, pred: () => boolean, guard = 150): void {
  while (!pred()) {
    if (guard-- <= 0) throw new Error("until(): predicate never satisfied");
    if (ctx.s.phase === "over") throw new Error("until(): game ended while waiting");
    run(ctx, [{ type: "endTurn", player: ctx.s.turnPlayer }]);
  }
}

function readyToPlay(ctx: Ctx, pid: PID, cardId: string, minDon?: number): string {
  const need = minDon ?? (ctx.db(cardId).cost ?? 0);
  until(ctx, () => ctx.s.turnPlayer === pid && ctx.s.turn > 2 && !!handIid(ctx, pid, cardId)
    && ctx.s.players[pid].don.active >= need);
  return handIid(ctx, pid, cardId)!;
}

function playNow(ctx: Ctx, pid: PID, cardId: string): string {
  const iid = readyToPlay(ctx, pid, cardId);
  run(ctx, [{ type: "playCard", player: pid, iid }]);
  return iid;
}

const leader = (ctx: Ctx, pid: PID) => ctx.s.players[pid].leaderIid;

// ─── M3 exit: batch coverage ─────────────────────────────────────────────────

describe("M3 exit: recompiled batch coverage", () => {
  it("≥90% of ST01+OP01 is IR-complete after the tier-2 recompile", () => {
    const rows = coverage();
    expect(rows.ALL.coveredPct).toBeGreaterThanOrEqual(90);
    expect(rows.ST01.coveredPct).toBe(100);
  });
});

// ─── [Activate: Main] (10-2-2, M3 exit) ─────────────────────────────────────

describe("[Activate: Main] intent", () => {
  it("pays the cost, resolves, and honors [Once Per Turn] (10-2-13-3)", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const am = playNow(ctx, "alice", "NC-AMDRAW");
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.don.active >= 1
      && ctx.s.players.alice.zones.characterArea.includes(am));
    // affordance mirrors legality
    expect(legalMoves(ctx.db, ctx.s).activatable).toContainEqual({ iid: am, effectIndex: 0 });
    const handBefore = ctx.s.players.alice.zones.hand.length;
    const activeBefore = ctx.s.players.alice.don.active;
    run(ctx, [{ type: "activateMain", player: "alice", iid: am, effectIndex: 0 }]);
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore + 1);
    expect(ctx.s.players.alice.don.active).toBe(activeBefore - 1); // ① rested (8-3-1-5)
    // [Once Per Turn]: a second activation this turn is illegal and unlisted
    expect(() => applyIntent(ctx.db, ctx.s, { type: "activateMain", player: "alice", iid: am, effectIndex: 0 }))
      .toThrow(/10-2-13-3/);
    expect(legalMoves(ctx.db, ctx.s).activatable).not.toContainEqual({ iid: am, effectIndex: 0 });
    // next own turn it is available again
    run(ctx, [{ type: "endTurn", player: "alice" }, { type: "endTurn", player: "bob" }]);
    expect(legalMoves(ctx.db, ctx.s).activatable).toContainEqual({ iid: am, effectIndex: 0 });
    run(ctx, [{ type: "activateMain", player: "alice", iid: am, effectIndex: 0 }]);
  });

  it("M3 EXIT — ST01-001 (real card): give 1 rested DON!! to the Leader or a Character, once per turn", () => {
    const realDb = makeRealDb();
    const deck = realStarterDeck();
    const ctx = newCtx(deck, deck, realDb, { leaderA: "ST01-001", leaderB: "ST01-001", seed: "st01-leader" });
    // get a character on the field: paying its cost rests DON (8-3-1-5 ↔ 6-5-3)
    const cheap = () => ctx.s.players.alice.zones.hand.find((iid) => {
      const c = realDb(ctx.s.players.alice.instances[iid].cardId);
      return c.category === "Character" && (c.cost ?? 0) <= ctx.s.players.alice.don.active;
    });
    until(ctx, () => ctx.s.turnPlayer === "alice" && !!cheap());
    const charIid = cheap()!;
    run(ctx, [{ type: "playCard", player: "alice", iid: charIid }]);
    drainAnyChoices(ctx); // some ST01 cards have [On Play] effects
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.don.rested >= 1
      && ctx.s.players.alice.zones.characterArea.length > 0);
    const aliceLeader = leader(ctx, "alice");
    // the leader ability is listed as activatable
    expect(legalMoves(ctx.db, ctx.s).activatable).toContainEqual({ iid: aliceLeader, effectIndex: 0 });
    const restedBefore = ctx.s.players.alice.don.rested;
    run(ctx, [{ type: "activateMain", player: "alice", iid: aliceLeader, effectIndex: 0 }]);
    // "this Leader or 1 of your Characters" → a real choice
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "alice", actionKind: "giveRestedDon" });
    const target = ctx.s.players.alice.zones.characterArea[0];
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [target] }]);
    expect(ctx.s.players.alice.don.given[target]).toBe(1);
    expect(ctx.s.players.alice.don.rested).toBe(restedBefore - 1);
    // [Once Per Turn] (10-2-13-3)
    expect(() => applyIntent(ctx.db, ctx.s, { type: "activateMain", player: "alice", iid: aliceLeader, effectIndex: 0 }))
      .toThrow(/10-2-13-3/);
  });
});

// ─── peek/search (M3 exit — Nami OP01-016) ───────────────────────────────────

describe("peek/search window", () => {
  it("M3 EXIT — Nami OP01-016 (real card): look at 5, take 1 {Straw Hat Crew}, rest to the bottom in chosen order", () => {
    const realDb = makeRealDb();
    const deck = realStarterDeck(); // all-ST01: every character is {Straw Hat Crew}
    const namiDeck = ["OP01-016", "OP01-016", "OP01-016", "OP01-016", ...deck.slice(4)];
    const ctx = newCtx(namiDeck, deck, realDb, { seed: "nami", leaderA: "ST01-001", leaderB: "ST01-001" });
    const nami = readyToPlay(ctx, "alice", "OP01-016");
    const deckBefore = [...ctx.s.players.alice.zones.deck];
    run(ctx, [{ type: "playCard", player: "alice", iid: nami }]);
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "peekSelect", player: "alice", mode: "hand", rest: "bottomAnyOrder", takeCount: 1 });
    if (pc?.kind !== "peekSelect") return;
    expect(pc.cards).toEqual(deckBefore.slice(0, 5)); // the top 5, in order
    // eligible = {Straw Hat Crew} cards other than [Nami] (nameExcludes)
    for (const iid of pc.eligible) {
      const card = realDb(ctx.s.players.alice.instances[iid].cardId);
      expect(card.types).toContain("Straw Hat Crew");
      expect((card.name ?? "").toLowerCase()).not.toContain("nami");
    }
    expect(pc.eligible.length).toBeGreaterThan(0);
    const take = pc.eligible[0];
    const rest = pc.cards.filter((iid) => iid !== take).reverse(); // a deliberate order
    // an ineligible take is rejected
    const ineligible = pc.cards.find((iid) => !pc.eligible.includes(iid));
    if (ineligible) {
      expect(() => applyIntent(ctx.db, ctx.s, { type: "respondPeek", player: "alice", take: [ineligible], restBottom: rest }))
        .toThrow(/illegal take/);
    }
    run(ctx, [{ type: "respondPeek", player: "alice", take: [take], restBottom: rest }]);
    expect(ctx.s.players.alice.zones.hand).toContain(take);
    // the rest went to the BOTTOM in exactly the chosen order
    expect(ctx.s.players.alice.zones.deck.slice(-rest.length)).toEqual(rest);
    expect(ctx.s.players.alice.zones.deck).toHaveLength(deckBefore.length - 1);
    expect(ctx.s.exec).toBeNull();
    expect(ctx.s.pendingChoice).toBeNull();
  });

  it("topOrBottomAnyOrder splits the rest between top and bottom", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const scry = readyToPlay(ctx, "alice", "NC-SCRY");
    const deckBefore = [...ctx.s.players.alice.zones.deck];
    run(ctx, [{ type: "playCard", player: "alice", iid: scry }]);
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "peekSelect", mode: "none", rest: "topOrBottomAnyOrder" });
    if (pc?.kind !== "peekSelect") return;
    const [a, b, c] = pc.cards;
    // a stays on top, b+c to the bottom (c before b — order is ours)
    run(ctx, [{ type: "respondPeek", player: "alice", take: [], restTop: [a], restBottom: [c, b] }]);
    expect(ctx.s.players.alice.zones.deck[0]).toBe(a);
    expect(ctx.s.players.alice.zones.deck.slice(-2)).toEqual([c, b]);
    expect(ctx.s.players.alice.zones.deck).toHaveLength(deckBefore.length);
    // an incomplete partition is rejected (fresh scenario would be needed to retry — validation only)
  });
});

// ─── DON manipulation ────────────────────────────────────────────────────────

describe("DON!! costs and manipulation", () => {
  it("DON!!−X with attached DON opens payDon; the composition is validated (8-3-1-6)", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const pd = playNow(ctx, "alice", "NC-PAYDON");
    // attach a DON and activate in the SAME turn (given DON return at refresh, 6-2-3)
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.don.active >= 2
      && ctx.s.players.alice.zones.characterArea.includes(pd));
    const lead = leader(ctx, "alice");
    run(ctx, [{ type: "giveDon", player: "alice", targetIid: lead }]);
    const deckBefore = ctx.s.players.alice.don.deck;
    const handBefore = ctx.s.players.alice.zones.hand.length;
    run(ctx, [{ type: "activateMain", player: "alice", iid: pd, effectIndex: 0 }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "payDon", player: "alice", amount: 2 });
    // wrong total rejected
    expect(() => applyIntent(ctx.db, ctx.s, { type: "respondPayDon", player: "alice", fromActive: 1, fromRested: 0, fromGiven: {} }))
      .toThrow(/exactly 2/);
    run(ctx, [{ type: "respondPayDon", player: "alice", fromActive: 1, fromRested: 0, fromGiven: { [lead]: 1 } }]);
    expect(ctx.s.players.alice.don.deck).toBe(deckBefore + 2);
    expect(ctx.s.players.alice.don.given[lead]).toBeUndefined();
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore + 1); // drew 1
  });

  it("DON!!−X without attached DON auto-composes (rested first) — no pause", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const pd = playNow(ctx, "alice", "NC-PAYDON"); // paying 1 rests 1 DON
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.don.active >= 2
      && ctx.s.players.alice.zones.characterArea.includes(pd));
    const deckBefore = ctx.s.players.alice.don.deck;
    run(ctx, [{ type: "activateMain", player: "alice", iid: pd, effectIndex: 0 }]);
    expect(ctx.s.pendingChoice).toBeNull();
    expect(ctx.s.players.alice.don.deck).toBe(deckBefore + 2);
  });

  it("standDon sets rested DON!! active again", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const sd = playNow(ctx, "alice", "NC-STANDDON"); // rests 1 DON paying it
    const before = ctx.s.players.alice.don;
    expect(before.rested).toBeGreaterThanOrEqual(1);
    run(ctx, [{ type: "activateMain", player: "alice", iid: sd, effectIndex: 0 }]);
    expect(ctx.s.players.alice.don.rested).toBe(Math.max(0, before.rested - 2));
    expect(ctx.s.players.alice.don.active).toBe(before.active + Math.min(2, before.rested));
  });
});

// ─── draw up to N / prev binding / cost choices ──────────────────────────────

describe("choices inside effects", () => {
  it("'draw up to 2' pauses on chooseNumber and draws the chosen amount", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const up = playNow(ctx, "alice", "NC-UPTO");
    run(ctx, [{ type: "activateMain", player: "alice", iid: up, effectIndex: 0 }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "chooseNumber", min: 0, max: 2 });
    expect(() => applyIntent(ctx.db, ctx.s, { type: "respondNumber", player: "alice", value: 3 })).toThrow(/between/);
    const handBefore = ctx.s.players.alice.zones.hand.length;
    run(ctx, [{ type: "respondNumber", player: "alice", value: 2 }]);
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore + 2);
  });

  it("prev ('that card') binds the previous action's target for real", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    // a rested own character IN THE SAME TURN (the refresh would stand it):
    // attack with it, then play NC-PREV right after
    const v = playNow(ctx, "alice", "NV-01");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[v].rested
      && ctx.s.players.alice.instances[v].playedOnTurn !== ctx.s.turn
      && !!handIid(ctx, "alice", "NC-PREV") && ctx.s.players.alice.don.active >= 2);
    run(ctx, [
      { type: "attack", player: "alice", attackerIid: v, targetIid: leader(ctx, "bob") },
      { type: "passCounter", player: "bob" }, // 2000 < 5000 → lost, v stays rested
    ]);
    const prev = handIid(ctx, "alice", "NC-PREV")!;
    expect(ctx.s.players.alice.instances[v].rested).toBe(true);
    run(ctx, [{ type: "playCard", player: "alice", iid: prev }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "selectTargets", actionKind: "standTarget" });
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [v] }]);
    // the SAME card stood AND got +2000 — no second selection
    expect(ctx.s.pendingChoice).toBeNull();
    expect(ctx.s.players.alice.instances[v].rested).toBe(false);
    expect(effectivePower(ctx.db, ctx.s, "alice", v)).toBe(4000);
  });

  it("a trashFromHand cost pauses on a card choice, then resolves (8-3-1)", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const tfh = playNow(ctx, "alice", "NC-TFH");
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.zones.hand.length >= 2);
    const handBefore = ctx.s.players.alice.zones.hand.length;
    run(ctx, [{ type: "activateMain", player: "alice", iid: tfh, effectIndex: 0 }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "selectTargets", actionKind: "discard" });
    const pc = ctx.s.pendingChoice;
    if (pc?.kind !== "selectTargets") return;
    const victim = pc.candidates[0].iid;
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [victim] }]);
    expect(ctx.s.players.alice.zones.trash).toContain(victim);
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore); // −1 trashed, +1 drawn
  });

  it("a lifeToHand cost is paid from the top of the Life area (optional effect)", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const iid = readyToPlay(ctx, "alice", "NC-L2H");
    const lifeBefore = ctx.s.players.alice.zones.life.length;
    const topLife = ctx.s.players.alice.zones.life[lifeBefore - 1];
    run(ctx, [{ type: "playCard", player: "alice", iid }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "mayActivate", player: "alice" });
    run(ctx, [{ type: "respondMay", player: "alice", activate: true }]);
    expect(ctx.s.players.alice.zones.life).toHaveLength(lifeBefore - 1);
    expect(ctx.s.players.alice.zones.hand).toContain(topLife);
    expect(keywordsOf(ctx.db, ctx.s, "alice", iid).has("Rush")).toBe(true);
    // Rush granted → it can attack right away
    run(ctx, [{ type: "attack", player: "alice", attackerIid: iid, targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.battle).not.toBeNull();
  });
});

// ─── tier-2 zone movement ────────────────────────────────────────────────────

describe("tier-2 zone movement", () => {
  it("playFromZone (hand, free) plays without paying DON", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.turn > 2 && !!handIid(ctx, "alice", "NC-PLAYH")
      && ctx.s.players.alice.don.active >= 2
      && ctx.s.players.alice.zones.hand.some((iid) => {
        const c = ctx.db(ctx.s.players.alice.instances[iid].cardId);
        return c.category === "Character" && (c.cost ?? 0) <= 1 && ctx.s.players.alice.instances[iid].cardId !== "NC-PLAYH";
      }));
    const ph = handIid(ctx, "alice", "NC-PLAYH")!;
    run(ctx, [{ type: "playCard", player: "alice", iid: ph }]);
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "selectTargets", actionKind: "playFromZone" });
    if (pc?.kind !== "selectTargets") return;
    const donBefore = { ...ctx.s.players.alice.don };
    const freebie = pc.candidates[0].iid;
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [freebie] }]);
    expect(ctx.s.players.alice.zones.characterArea).toContain(freebie);
    expect(ctx.s.players.alice.don).toEqual(donBefore); // free
    expect(ctx.s.players.alice.instances[freebie].playedOnTurn).toBe(ctx.s.turn); // 3-7-4
  });

  it("returnToHand bounces an opposing character (modifiers drop, 3-1-6)", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const bChar = playNow(ctx, "bob", "NV-03");
    const b = readyToPlay(ctx, "alice", "NC-BOUNCE");
    run(ctx, [{ type: "playCard", player: "alice", iid: b }]);
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "selectTargets", actionKind: "returnToHand" });
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [bChar] }]);
    expect(ctx.s.players.bob.zones.hand).toContain(bChar);
    expect(ctx.s.players.bob.zones.characterArea).not.toContain(bChar);
  });

  it("returnToDeck places the character at the bottom of the owner's deck", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const bChar = playNow(ctx, "bob", "NV-04");
    const d = readyToPlay(ctx, "alice", "NC-DECKB");
    run(ctx, [{ type: "playCard", player: "alice", iid: d }]);
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [bChar] }]);
    const bobDeck = ctx.s.players.bob.zones.deck;
    expect(bobDeck[bobDeck.length - 1]).toBe(bChar);
    expect(ctx.s.players.bob.zones.characterArea).not.toContain(bChar);
  });

  it("mill moves deck-top cards to the trash", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const m = readyToPlay(ctx, "alice", "NC-MILL");
    const bobDeckBefore = [...ctx.s.players.bob.zones.deck];
    const bobTrashBefore = ctx.s.players.bob.zones.trash.length;
    run(ctx, [{ type: "playCard", player: "alice", iid: m }]);
    expect(ctx.s.players.bob.zones.deck).toHaveLength(bobDeckBefore.length - 2);
    expect(ctx.s.players.bob.zones.trash).toHaveLength(bobTrashBefore + 2);
    expect(ctx.s.players.bob.zones.trash.slice(-2)).toEqual(bobDeckBefore.slice(0, 2));
  });

  it("addFromTrashToHand recovers a character", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    // get a character into alice's trash via the trashFromHand cost
    const tfh = playNow(ctx, "alice", "NC-TFH");
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.zones.hand.length >= 2);
    run(ctx, [{ type: "activateMain", player: "alice", iid: tfh, effectIndex: 0 }]);
    if (ctx.s.pendingChoice?.kind === "selectTargets") {
      run(ctx, [{ type: "respondTargets", player: "alice", iids: [ctx.s.pendingChoice.candidates[0].iid] }]);
    }
    expect(ctx.s.players.alice.zones.trash.length).toBeGreaterThan(0);
    const ath = readyToPlay(ctx, "alice", "NC-ATH");
    run(ctx, [{ type: "playCard", player: "alice", iid: ath }]);
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "selectTargets", actionKind: "addFromTrashToHand" });
    if (pc?.kind !== "selectTargets") return;
    const back = pc.candidates[0].iid;
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [back] }]);
    expect(ctx.s.players.alice.zones.hand).toContain(back);
    expect(ctx.s.players.alice.zones.trash).not.toContain(back);
  });

  it("canAttackActiveCharacters lets a character hit ACTIVE targets (M3 permission)", () => {
    const ctx = newCtx(M3_DECK, VAN_DECK);
    const bChar = playNow(ctx, "bob", "NV-05"); // stays ACTIVE
    const atk = playNow(ctx, "alice", "NV-01");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[atk].rested
      && ctx.s.players.alice.instances[atk].playedOnTurn !== ctx.s.turn
      && !!handIid(ctx, "alice", "NC-CANATK") && ctx.s.players.alice.don.active >= 1
      && !ctx.s.players.bob.instances[bChar].rested);
    // without the permission, the active character is not a legal target
    expect(() => applyIntent(ctx.db, ctx.s, { type: "attack", player: "alice", attackerIid: atk, targetIid: bChar }))
      .toThrow(/RESTED/);
    run(ctx, [{ type: "playCard", player: "alice", iid: handIid(ctx, "alice", "NC-CANATK")! }]);
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [atk] }]);
    expect(hasRestriction(ctx.db, ctx.s, "alice", atk, "canAttackActiveCharacters")).toBe(true);
    expect(legalMoves(ctx.db, ctx.s).attackers.find((a) => a.iid === atk)?.targets).toContain(bChar);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: atk, targetIid: bChar }]);
    expect(ctx.s.battle?.targetIid).toBe(bChar);
    run(ctx, [{ type: "passCounter", player: "bob" }]); // 2000 ≥ 2000 → K.O.
    expect(ctx.s.players.bob.zones.trash).toContain(bChar);
  });
});

// ─── End Phase & end-of-battle timings (6-6-1, 7-1-5-2) ─────────────────────

describe("End Phase and end-of-battle effects", () => {
  it("[End of Your Turn] (turn player) resolves before [End of Your Opponent's Turn], before the turn passes", () => {
    const ctx = newCtx(EO_DECK, EO_DECK);
    const eot = playNow(ctx, "alice", "NC-EOT");
    const eoot = playNow(ctx, "bob", "NC-EOOT");
    until(ctx, () => ctx.s.turnPlayer === "alice"
      && ctx.s.players.alice.zones.characterArea.includes(eot)
      && ctx.s.players.bob.zones.characterArea.includes(eoot));
    const aHand = ctx.s.players.alice.zones.hand.length;
    const bHand = ctx.s.players.bob.zones.hand.length;
    const ev = run(ctx, [{ type: "endTurn", player: "alice" }]);
    const acts = ev.filter((e) => e.type === "effectActivated");
    expect(acts.map((e) => e.type === "effectActivated" && e.player)).toEqual(["alice", "bob"]); // 6-6-1-1/2
    const types = ev.map((e) => e.type);
    expect(types.indexOf("effectActivated")).toBeLessThan(types.indexOf("turnEnded")); // effects before expiry/turn pass
    expect(ctx.s.players.alice.zones.hand).toHaveLength(aHand + 1);
    // bob drew from the End Phase effect AND from his own Draw Phase
    expect(ctx.s.players.bob.zones.hand).toHaveLength(bHand + 2);
    expect(ctx.s.turnPlayer).toBe("bob");
  });

  it("end-of-battle effects resolve after damage, before the battle closes (7-1-5-2)", () => {
    const ctx = newCtx(EO_DECK, VAN_DECK);
    const eob = playNow(ctx, "alice", "NC-EOB");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested
      && ctx.s.players.alice.zones.characterArea.includes(eob));
    const handBefore = ctx.s.players.alice.zones.hand.length;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    const ev = run(ctx, [{ type: "passCounter", player: "bob" }]);
    const types = ev.map((e) => e.type);
    const drawAt = types.indexOf("cardsDrawn");
    const endAt = types.indexOf("battleEnded");
    expect(drawAt).toBeGreaterThanOrEqual(0);
    expect(endAt).toBeGreaterThan(drawAt); // 7-1-5-2 before 7-1-5-3/4/5
    expect(ctx.s.players.alice.zones.hand.length).toBeGreaterThan(handBefore);
    expect(ctx.s.battle).toBeNull();
  });
});

// ─── helpers for real-card tests ─────────────────────────────────────────────

interface RawCard {
  id: string; name: string; category: EngineCard["category"]; colors: string[];
  cost: number | null; power: number | null; counter: number | null;
  types: string[]; set: string;
}
let realPool: Map<string, RawCard> | null = null;
function makeRealDb(): CardDb {
  if (!realPool) {
    const raw: RawCard[] = JSON.parse(readFileSync(new URL("../../../public/data/cards.json", import.meta.url), "utf8"));
    realPool = new Map(raw.filter((c) => c.set === "ST01" || c.set === "OP01").map((c) => [c.id, c]));
  }
  return (id) => {
    const c = realPool!.get(id);
    if (!c) throw new Error(`unknown card ${id}`);
    return {
      id: c.id, category: c.category, cost: c.cost, power: c.power, counter: c.counter,
      colors: c.colors, types: c.types, name: c.name, compiled: getCompiledCard(c.id),
    };
  };
}
function realStarterDeck(): string[] {
  // 12 ST01 numbers × 4 + 2 = a legal mono-red 50 (5-1-2)
  const ids = ["ST01-002", "ST01-003", "ST01-004", "ST01-005", "ST01-006", "ST01-007",
    "ST01-008", "ST01-009", "ST01-010", "ST01-011", "ST01-012", "ST01-013"];
  return [...ids.flatMap((id) => Array<string>(4).fill(id)), "ST01-014", "ST01-014"];
}

/** Answer whatever ChoiceRequests the last intents left, declining extras. */
function drainAnyChoices(ctx: Ctx): void {
  let guard = 25;
  while (ctx.s.pendingChoice && ctx.s.phase !== "over" && guard-- > 0) {
    const pc = ctx.s.pendingChoice;
    switch (pc.kind) {
      case "selectTargets":
        run(ctx, [{ type: "respondTargets", player: pc.player, iids: pc.upTo ? [] : pc.candidates.slice(0, Math.min(pc.count, pc.candidates.length)).map((c) => c.iid) }]);
        break;
      case "mayActivate": run(ctx, [{ type: "respondMay", player: pc.player, activate: false }]); break;
      case "manualResolve": run(ctx, [{ type: "ackManual", player: pc.player }]); break;
      case "peekSelect": {
        const remaining = pc.cards;
        run(ctx, [{
          type: "respondPeek", player: pc.player, take: [],
          restTop: pc.rest === "topAnyOrder" || pc.rest === "topOrBottomAnyOrder" ? remaining : [],
          restBottom: pc.rest === "bottomAnyOrder" ? remaining : [],
        }]);
        break;
      }
      case "chooseNumber": run(ctx, [{ type: "respondNumber", player: pc.player, value: pc.min }]); break;
      default: throw new Error(`unexpected choice ${pc.kind}`);
    }
  }
}
