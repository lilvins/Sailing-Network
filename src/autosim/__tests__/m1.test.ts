import { describe, expect, it } from "vitest";
import type { Effect, Keyword, Selector } from "../ir/types";
import { applyEvent, type GameEvent } from "../engine/events";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import type { PlayerIntent } from "../engine/intents";
import {
  effectivePower, hasRestriction, keywordsOf,
  type AutoGameState, type CardDb, type EngineCard, type PID,
} from "../engine/state";
import { legalMoves } from "../engine/legality";

/**
 * M1 test suite (AUTOSIM_PLAN.md §8 M1): keyword effects (10-1), full Counter
 * Step (7-1-3), [Trigger] flow (10-1-5, 8-6-2-1), the 8-6 auto-effect queue
 * and the tier-1 action executor. Exit criterion: a scripted hotseat game that
 * exercises Rush, Blocker, Double Attack, counter values, a [Counter] event
 * and both [Trigger] decisions, down to a victory (see the last describe).
 */

// ─── synthetic card DB (construction-legal, 5-1-2) ──────────────────────────

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
    colors: ["Red"], types: ["M1"],
    compiled: hasIR ? {
      cardId: "TEST-000", version: 1, confidence: 1,
      classification: (opts.effects?.length ?? 0) > 0 ? "compiled" : "keyword-only",
      keywords: opts.keywords ?? [], effects: opts.effects ?? [],
    } : undefined,
  };
}

// leaders (cost = Life value, local DB quirk)
addCard("ML-A", { cat: "Leader", cost: 4, power: 5000 });
addCard("ML-B", { cat: "Leader", cost: 4, power: 5000 });
addCard("ML-C", { cat: "Leader", cost: 1, power: 5000 }); // 1-Life leader (Double Attack lethal test)
CARDS["ML-B"].colors = ["Blue", "Red"]; // multicolor → all-Red decks legal for both (5-1-2-2)
CARDS["ML-C"].colors = ["Red"];

// keyword characters (10-1)
addCard("MC-RUSH",  { cost: 1, power: 3000, counter: 1000, keywords: ["Rush"] });
addCard("MC-RUSHC", { cost: 1, power: 3000, counter: 1000, keywords: ["RushCharacter"] });
addCard("MC-DA",    { cost: 2, power: 5000, keywords: ["DoubleAttack"] });
addCard("MC-BAN",   { cost: 2, power: 5000, keywords: ["Banish"] });
addCard("MC-UNB",   { cost: 2, power: 5000, keywords: ["Unblockable"] });
addCard("MC-BLK",   { cost: 1, power: 2000, counter: 1000, keywords: ["Blocker"] });
addCard("MC-VAN",   { cost: 1, power: 2000, counter: 2000 });

// auto effects (8-6 queue)
addCard("MC-WA", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "whenAttacking", actions: [
    { kind: "powerMod", sel: sel("self", "characterArea", { self: true }), amount: 2000, duration: "thisBattle" },
  ]},
]});
addCard("MC-WAOPT", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "whenAttacking", optional: true, actions: [{ kind: "draw", count: 1 }] },
]});
addCard("MC-OOA", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "onYourOpponentsAttack", actions: [
    { kind: "powerMod", sel: sel("self", "leader"), amount: 1000, duration: "thisBattle" },
  ]},
]});
addCard("MC-OK", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "onKO", actions: [{ kind: "draw", count: 1 }] },
]});

// [On Play] tier-1 executor coverage
addCard("MC-OPKO", { cost: 3, power: 4000, effects: [
  { timing: "onPlay", actions: [
    { kind: "koTarget", sel: sel("opponent", "characterArea", { filter: { costAtMost: 2 }, upTo: true }) },
  ]},
]});
addCard("MC-OPGK", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "grantKeyword", keyword: "Rush", duration: "thisTurn", sel: sel("self", "characterArea", { self: true }) },
  ]},
]});
addCard("MC-OPNB", { cost: 1, power: 2000, counter: 1000, effects: [
  { timing: "onPlay", actions: [
    { kind: "restriction", what: "cannotBlock", duration: "thisTurn", sel: sel("opponent", "characterArea", { filter: { hasKeyword: "Blocker" }, upTo: true }) },
  ]},
]});
addCard("MC-OPRES", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "restriction", what: "cannotAttack", duration: "untilEndOfOpponentsNextTurn", sel: sel("opponent", "characterArea", { upTo: true }) },
  ]},
]});
addCard("MC-OPDISC", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "discard", who: "opponent", sel: sel("opponent", "hand", { chooser: "opponent" }) },
  ]},
]});
addCard("MC-OPSTD", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "standTarget", sel: sel("self", "characterArea", { filter: { rested: true, excludeSelf: true }, upTo: true }) },
  ]},
]});
addCard("MC-OPREST", { cost: 2, power: 3000, effects: [
  { timing: "onPlay", actions: [
    { kind: "restTarget", sel: sel("opponent", "characterArea", { filter: { rested: false }, upTo: true }) },
  ]},
]});
addCard("MC-MANUAL", { cost: 1, power: 2000, effects: [
  // negateEffect stays outside the executor (M4+) → manualResolve
  { timing: "onPlay", actions: [{ kind: "negateEffect", sel: sel("opponent", "characterArea"), scope: "all", duration: "thisTurn" }] },
]});

// events
addCard("ME-CTR", { cat: "Event", cost: 1, effects: [
  { timing: "counter", actions: [
    { kind: "powerMod", sel: sel("self", "leaderOrCharacter", { upTo: true }), amount: 2000, duration: "thisBattle" },
  ]},
]});
addCard("ME-MAIN", { cat: "Event", cost: 1, effects: [
  { timing: "main", actions: [{ kind: "draw", count: 1 }] },
]});

// [Trigger] cards + vanilla filler (numbered, 4-copy rule 5-1-2-3)
for (let i = 1; i <= 7; i++) {
  addCard(`MT-0${i}`, { cost: 1, power: 2000, counter: 1000, effects: [
    { timing: "trigger", actions: [{ kind: "draw", count: 1 }] },
  ]});
}
for (let i = 1; i <= 6; i++) {
  addCard(`MP-0${i}`, { cost: 2, power: 3000, counter: 1000, effects: [
    { timing: "trigger", actions: [
      { kind: "playFromZone", zone: "hand", free: true, sel: sel("self", "hand", { self: true }) },
    ]},
  ]});
}
for (let i = 1; i <= 13; i++) {
  addCard(`MV-${String(i).padStart(2, "0")}`, { cost: 1, power: 2000, counter: 1000 });
}

const db: CardDb = (id) => {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};

// ─── decks ───────────────────────────────────────────────────────────────────

function deckOf(entries: [string, number][]): string[] {
  const d = entries.flatMap(([id, n]) => Array<string>(n).fill(id));
  if (d.length !== 50) throw new Error(`deck has ${d.length} cards`);
  return d;
}
const mv = (n: number, copies = 4): [string, number][] =>
  Array.from({ length: n }, (_, i) => [`MV-${String(i + 1).padStart(2, "0")}`, copies] as [string, number]);

const VANILLA_DECK = deckOf([...mv(12), ["MV-13", 2]]);
const ALICE_KW_DECK = deckOf([
  ["MC-RUSH", 4], ["MC-RUSHC", 4], ["MC-DA", 4], ["MC-BAN", 4], ["MC-UNB", 4],
  ["MC-WA", 4], ["MC-WAOPT", 4], ["MC-OPNB", 4], ["MC-OPGK", 4], ["MC-VAN", 4],
  ...mv(2), ["MV-03", 2],
]);
const BOB_KW_DECK = deckOf([
  ["MC-BLK", 4], ["MC-OOA", 4], ["MC-OK", 4], ["MC-VAN", 4], ["ME-CTR", 4],
  ...mv(7), ["MV-08", 2],
]);
const TRIGGER_DECK = deckOf([
  ...Array.from({ length: 6 }, (_, i) => [`MT-0${i + 1}`, 4] as [string, number]),
  ...Array.from({ length: 6 }, (_, i) => [`MP-0${i + 1}`, 4] as [string, number]),
  ["MT-07", 2],
]);
const EFFECTS_DECK = deckOf([
  ["MC-OPKO", 4], ["MC-OPDISC", 4], ["MC-OPRES", 4], ["MC-OPSTD", 4], ["MC-OPREST", 4],
  ["MC-MANUAL", 4], ["MC-VAN", 4], ["ME-MAIN", 4], ...mv(4), ["MV-05", 2],
]);

// ─── harness ─────────────────────────────────────────────────────────────────

interface Ctx { s: AutoGameState; log: GameEvent[] }

function run(ctx: Ctx, intents: PlayerIntent[]): GameEvent[] {
  const emitted: GameEvent[] = [];
  for (const intent of intents) {
    const r = applyIntent(db, ctx.s, intent);
    ctx.s = r.state;
    ctx.log.push(...r.events);
    emitted.push(...r.events);
  }
  return emitted;
}

function newCtx(deckA: string[], deckB: string[], opts: { seed?: string; leaderA?: string; leaderB?: string } = {}): Ctx {
  const config: GameConfig = {
    seed: opts.seed ?? "m1-seed",
    players: [
      { id: "alice", leader: opts.leaderA ?? "ML-A", deck: deckA },
      { id: "bob", leader: opts.leaderB ?? "ML-B", deck: deckB },
    ],
    firstPlayer: "alice",
  };
  const { state, events } = createGame(db, config);
  const ctx: Ctx = { s: state, log: [...events] };
  run(ctx, [
    { type: "respondMulligan", player: "alice", take: false },
    { type: "respondMulligan", player: "bob", take: false },
  ]);
  return ctx;
}

const handIid = (ctx: Ctx, pid: PID, cardId: string) =>
  ctx.s.players[pid].zones.hand.find((iid) => ctx.s.players[pid].instances[iid].cardId === cardId);

/** Pass turns (no other actions) until the predicate holds. */
function until(ctx: Ctx, pred: () => boolean, guard = 120): void {
  while (!pred()) {
    if (guard-- <= 0) throw new Error("until(): predicate never satisfied");
    if (ctx.s.phase === "over") throw new Error("until(): game ended while waiting");
    run(ctx, [{ type: "endTurn", player: ctx.s.turnPlayer }]);
  }
}

/** Advance until it's `pid`'s turn (past both first turns, 6-5-6-1), the card
 *  is in hand and affordable; returns its iid without playing it. */
function readyToPlay(ctx: Ctx, pid: PID, cardId: string): string {
  until(ctx, () =>
    ctx.s.turnPlayer === pid && ctx.s.turn > 2 && !!handIid(ctx, pid, cardId)
    && ctx.s.players[pid].don.active >= (CARDS[cardId].cost ?? 0));
  return handIid(ctx, pid, cardId)!;
}

/** Play the card now (assumes readyToPlay conditions hold). */
function playNow(ctx: Ctx, pid: PID, cardId: string): string {
  const iid = readyToPlay(ctx, pid, cardId);
  run(ctx, [{ type: "playCard", player: pid, iid }]);
  return iid;
}

/** Puts a rested `cardId` Character on `pid`'s board by playing it and
 *  attacking the opponent's leader with it on a later turn (losing battles are
 *  fine — the card just stays rested). */
function boardRested(ctx: Ctx, pid: PID, cardId: string): string {
  const iid = playNow(ctx, pid, cardId);
  const opp = pid === "alice" ? "bob" : "alice";
  until(ctx, () => ctx.s.turnPlayer === pid && !ctx.s.players[pid].instances[iid].rested
    && ctx.s.players[pid].instances[iid].playedOnTurn !== ctx.s.turn);
  run(ctx, [
    { type: "attack", player: pid, attackerIid: iid, targetIid: ctx.s.players[opp].leaderIid },
  ]);
  drainToDamage(ctx); // decline everything in the battle windows
  return iid;
}

/** Resolve the current battle by declining every window (no block, no counter,
 *  decline triggers, empty/ack choices) until the battle is over. */
function drainToDamage(ctx: Ctx): void {
  let guard = 30;
  while (ctx.s.battle && guard-- > 0) {
    const pc = ctx.s.pendingChoice;
    if (!pc) throw new Error("battle without a pending choice");
    if (pc.kind === "blockWindow") run(ctx, [{ type: "respondBlock", player: pc.player, blockerIid: null }]);
    else if (pc.kind === "counterWindow") run(ctx, [{ type: "passCounter", player: pc.player }]);
    else if (pc.kind === "triggerDecision") run(ctx, [{ type: "respondTrigger", player: pc.player, activate: false }]);
    else if (pc.kind === "mayActivate") run(ctx, [{ type: "respondMay", player: pc.player, activate: false }]);
    else if (pc.kind === "selectTargets") run(ctx, [{ type: "respondTargets", player: pc.player, iids: pc.upTo ? [] : pc.candidates.slice(0, Math.min(pc.count, pc.candidates.length)).map((c) => c.iid) }]);
    else if (pc.kind === "manualResolve") run(ctx, [{ type: "ackManual", player: pc.player }]);
    else throw new Error(`unexpected choice ${pc.kind}`);
    if (ctx.s.phase === "over") return;
  }
}

const leader = (ctx: Ctx, pid: PID) => ctx.s.players[pid].leaderIid;

// ─── keyword effects (10-1) ──────────────────────────────────────────────────

describe("[Rush] and [Rush: Character] (10-1-1, 10-1-6)", () => {
  it("a [Rush] character attacks the turn it is played; a vanilla one cannot (3-7-4)", () => {
    const ctx = newCtx(ALICE_KW_DECK, VANILLA_DECK);
    const rush = playNow(ctx, "alice", "MC-RUSH");
    expect(ctx.s.players.alice.instances[rush].playedOnTurn).toBe(ctx.s.turn);
    // legality agrees: the fresh Rush character is a listed attacker
    const lm = legalMoves(db, ctx.s);
    expect(lm.attackers.some((a) => a.iid === rush && a.targets.includes(leader(ctx, "bob")))).toBe(true);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: rush, targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.battle).not.toBeNull();
    drainToDamage(ctx);
    // a vanilla character played the same way cannot attack
    const van = playNow(ctx, "alice", "MC-VAN");
    expect(() => applyIntent(db, ctx.s, { type: "attack", player: "alice", attackerIid: van, targetIid: leader(ctx, "bob") }))
      .toThrow(/3-7-4/);
  });

  it("[Rush: Character] attacks characters — not the leader — on its play turn (10-1-6-1)", () => {
    const ctx = newCtx(ALICE_KW_DECK, VANILLA_DECK);
    const restedBob = boardRested(ctx, "bob", "MV-01");
    until(ctx, () => ctx.s.turnPlayer === "alice");
    const rc = playNow(ctx, "alice", "MC-RUSHC");
    expect(() => applyIntent(db, ctx.s, { type: "attack", player: "alice", attackerIid: rc, targetIid: leader(ctx, "bob") }))
      .toThrow(/10-1-6-1/);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: rc, targetIid: restedBob }]);
    drainToDamage(ctx);
    // 3000 ≥ 2000 → the rested character is K.O.'d (7-1-4-1-2)
    expect(ctx.s.players.bob.zones.trash).toContain(restedBob);
  });
});

describe("[Blocker] (10-1-4, 7-1-2) and [Unblockable] (10-1-7)", () => {
  it("opens the block window, redirects the attack and rests the blocker", () => {
    const ctx = newCtx(ALICE_KW_DECK, BOB_KW_DECK);
    const blk = playNow(ctx, "bob", "MC-BLK");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested);
    const lifeBefore = ctx.s.players.bob.zones.life.length;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "blockWindow", player: "bob", blockers: [blk] });
    run(ctx, [{ type: "respondBlock", player: "bob", blockerIid: blk }]);
    expect(ctx.s.battle!.targetIid).toBe(blk);                       // 10-1-4-1 redirect
    expect(ctx.s.players.bob.instances[blk].rested).toBe(true);      // activated by resting
    drainToDamage(ctx);
    expect(ctx.s.players.bob.zones.trash).toContain(blk);            // 5000 vs 2000 → K.O.
    expect(ctx.s.players.bob.zones.life).toHaveLength(lifeBefore);   // leader untouched
  });

  it("a rested [Blocker] is not offered (10-1-4-1 requires resting it)", () => {
    const ctx = newCtx(ALICE_KW_DECK, BOB_KW_DECK);
    boardRested(ctx, "bob", "MC-BLK");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.pendingChoice?.kind).toBe("counterWindow"); // no block window at all
    drainToDamage(ctx);
  });

  it("[Unblockable] suppresses the block window entirely (10-1-7-1)", () => {
    const ctx = newCtx(ALICE_KW_DECK, BOB_KW_DECK);
    playNow(ctx, "bob", "MC-BLK"); // bob has an ACTIVE blocker
    const unb = playNow(ctx, "alice", "MC-UNB");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[unb].rested
      && ctx.s.players.alice.instances[unb].playedOnTurn !== ctx.s.turn);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: unb, targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.pendingChoice?.kind).toBe("counterWindow");
    drainToDamage(ctx);
  });

  it("a cannotBlock restriction removes the blocker from the window (tier-1 restriction)", () => {
    const ctx = newCtx(ALICE_KW_DECK, BOB_KW_DECK);
    const blk = playNow(ctx, "bob", "MC-BLK");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested
      && !!handIid(ctx, "alice", "MC-OPNB") && ctx.s.players.alice.don.active >= 1);
    const opnb = handIid(ctx, "alice", "MC-OPNB")!;
    run(ctx, [{ type: "playCard", player: "alice", iid: opnb }]);
    // [On Play] restriction targets bob's Blocker (single candidate + upTo → still a choice)
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "alice" });
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [blk] }]);
    expect(hasRestriction(db, ctx.s, "bob", blk, "cannotBlock")).toBe(true);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.pendingChoice?.kind).toBe("counterWindow"); // blocker not offered
    drainToDamage(ctx);
    // thisTurn restriction expires at the End Phase (6-6-1-3)
    run(ctx, [{ type: "endTurn", player: "alice" }]);
    expect(hasRestriction(db, ctx.s, "bob", blk, "cannotBlock")).toBe(false);
  });
});

describe("[Double Attack] (10-1-2) and [Banish] (10-1-3)", () => {
  it("deals 2 damage to the leader: two Life cards in one battle (7-1-4-1-1-3)", () => {
    const ctx = newCtx(ALICE_KW_DECK, VANILLA_DECK);
    const da = playNow(ctx, "alice", "MC-DA");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[da].rested
      && ctx.s.players.alice.instances[da].playedOnTurn !== ctx.s.turn);
    const lifeBefore = ctx.s.players.bob.zones.life.length;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: da, targetIid: leader(ctx, "bob") }]);
    const ev = run(ctx, [{ type: "passCounter", player: "bob" }]);
    expect(ctx.s.players.bob.zones.life).toHaveLength(lifeBefore - 2);
    expect(ev.filter((e) => e.type === "lifeCardToHand")).toHaveLength(2);
  });

  it("wins when the second damage lands at 0 Life (7-1-4-1-1-1)", () => {
    const ctx = newCtx(ALICE_KW_DECK, VANILLA_DECK, { leaderB: "ML-C" }); // bob Life 1
    const da = playNow(ctx, "alice", "MC-DA");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[da].rested
      && ctx.s.players.alice.instances[da].playedOnTurn !== ctx.s.turn);
    run(ctx, [
      { type: "attack", player: "alice", attackerIid: da, targetIid: leader(ctx, "bob") },
      { type: "passCounter", player: "bob" },
    ]);
    expect(ctx.s.phase).toBe("over");
    expect(ctx.s.winner).toBe("alice");
    expect(ctx.s.winReason).toBe("leaderDamageAtZeroLife");
  });

  it("[Banish] trashes the Life card and never offers the [Trigger] (10-1-3-1)", () => {
    const ctx = newCtx(ALICE_KW_DECK, TRIGGER_DECK); // bob's Life is ALL triggers
    const ban = playNow(ctx, "alice", "MC-BAN");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[ban].rested
      && ctx.s.players.alice.instances[ban].playedOnTurn !== ctx.s.turn);
    const lifeBefore = ctx.s.players.bob.zones.life.length;
    const trashBefore = ctx.s.players.bob.zones.trash.length;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: ban, targetIid: leader(ctx, "bob") }]);
    const ev = run(ctx, [{ type: "passCounter", player: "bob" }]);
    expect(ctx.s.pendingChoice).toBeNull(); // no triggerDecision
    expect(ev.some((e) => e.type === "lifeCardTrashed")).toBe(true);
    expect(ev.some((e) => e.type === "lifeCardToHand")).toBe(false);
    expect(ctx.s.players.bob.zones.life).toHaveLength(lifeBefore - 1);
    expect(ctx.s.players.bob.zones.trash).toHaveLength(trashBefore + 1);
  });
});

// ─── [Trigger] flow (10-1-5, 8-6-2-1) ────────────────────────────────────────

describe("[Trigger] flow", () => {
  function attackIntoTriggers(ctx: Ctx) {
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.turn > 2
      && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested);
    run(ctx, [
      { type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") },
      { type: "passCounter", player: "bob" },
    ]);
  }

  it("suspends damage with a triggerDecision; declining adds the card to hand unrevealed (10-1-5-2)", () => {
    const ctx = newCtx(VANILLA_DECK, TRIGGER_DECK);
    attackIntoTriggers(ctx);
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "triggerDecision", player: "bob" });
    const iid = pc!.kind === "triggerDecision" ? pc!.iid : "";
    const handBefore = ctx.s.players.bob.zones.hand.length;
    const ev = run(ctx, [{ type: "respondTrigger", player: "bob", activate: false }]);
    expect(ev.some((e) => e.type === "triggerActivated")).toBe(false);
    expect(ctx.s.players.bob.zones.hand).toContain(iid);
    expect(ctx.s.players.bob.zones.hand).toHaveLength(handBefore + 1);
    expect(ctx.s.battle).toBeNull(); // damage resumed and the battle completed
  });

  it("activating executes the effect then trashes the card — unless the effect moved it (10-1-5-3)", () => {
    const ctx = newCtx(VANILLA_DECK, TRIGGER_DECK);
    for (let round = 0; round < 2; round++) {
      attackIntoTriggers(ctx);
      const pc = ctx.s.pendingChoice;
      expect(pc?.kind).toBe("triggerDecision");
      if (pc?.kind !== "triggerDecision") return;
      const { iid, cardId } = pc;
      const handBefore = ctx.s.players.bob.zones.hand.length;
      const ev = run(ctx, [{ type: "respondTrigger", player: "bob", activate: true }]);
      expect(ev.some((e) => e.type === "triggerActivated")).toBe(true);
      if (cardId.startsWith("MT")) {
        // '[Trigger] Draw 1 card' → resolve, then trash the trigger card
        expect(ev.some((e) => e.type === "cardsDrawn" && e.player === "bob")).toBe(true);
        expect(ctx.s.players.bob.zones.trash).toContain(iid);
        expect(ctx.s.players.bob.zones.hand).toHaveLength(handBefore + 1); // the drawn card
      } else {
        // '[Trigger] Play this card' → it moves to the character area, no trash
        expect(ev.some((e) => e.type === "triggerCardPlayed")).toBe(true);
        expect(ctx.s.players.bob.zones.characterArea).toContain(iid);
        expect(ctx.s.players.bob.zones.trash).not.toContain(iid);
      }
      expect(ctx.s.battle).toBeNull(); // suspended damage resumed to completion (8-6-2-1)
    }
  });

  it("a Life card without [Trigger] flows straight to the hand — no pause", () => {
    const ctx = newCtx(TRIGGER_DECK, VANILLA_DECK); // BOB is vanilla here
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.turn > 2
      && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested);
    const lifeBefore = ctx.s.players.bob.zones.life.length;
    run(ctx, [
      { type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") },
      { type: "passCounter", player: "bob" },
    ]);
    expect(ctx.s.pendingChoice).toBeNull();
    expect(ctx.s.battle).toBeNull();
    expect(ctx.s.players.bob.zones.life).toHaveLength(lifeBefore - 1);
  });
});

// ─── Counter Step (7-1-3) ────────────────────────────────────────────────────

describe("Counter Step: [Counter] events (7-1-3-2-2)", () => {
  it("pays the cost, resolves the tier-1 powerMod, and keeps the window open", () => {
    const ctx = newCtx(VANILLA_DECK, BOB_KW_DECK);
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.turn > 2
      && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested
      && !!handIid(ctx, "bob", "ME-CTR") && ctx.s.players.bob.don.active >= 1);
    const evIid = handIid(ctx, "bob", "ME-CTR")!;
    const lifeBefore = ctx.s.players.bob.zones.life.length;
    const donActiveBefore = ctx.s.players.bob.don.active;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    // the window lists the event as usable
    const lm = legalMoves(db, ctx.s);
    expect(lm.counterEvents.some((e) => e.iid === evIid)).toBe(true);
    run(ctx, [{ type: "useCounterEvent", player: "bob", cardIid: evIid }]);
    // tier-1 powerMod with "up to 1" → target selection by bob
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "bob", actionKind: "powerMod" });
    run(ctx, [{ type: "respondTargets", player: "bob", iids: [leader(ctx, "bob")] }]);
    // the card cost was paid (7-1-3-2-2), the card trashed, the window reopened
    expect(ctx.s.players.bob.don.active).toBe(donActiveBefore - 1);
    expect(ctx.s.players.bob.zones.trash).toContain(evIid);
    expect(ctx.s.pendingChoice?.kind).toBe("counterWindow");
    expect(effectivePower(db, ctx.s, "bob", leader(ctx, "bob"))).toBe(7000); // 5000 + 2000
    run(ctx, [{ type: "passCounter", player: "bob" }]);
    // 5000 < 7000 → battle lost, no damage; thisBattle mod expired (7-1-5-3/4)
    expect(ctx.s.players.bob.zones.life).toHaveLength(lifeBefore);
    expect(ctx.s.modifiers).toHaveLength(0);
    expect(effectivePower(db, ctx.s, "bob", leader(ctx, "bob"))).toBe(5000);
  });

  it("counter values and events stack on the same battle (7-1-3-2 'as many times as they wish')", () => {
    const ctx = newCtx(VANILLA_DECK, BOB_KW_DECK);
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.turn > 2
      && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested
      && !!handIid(ctx, "bob", "ME-CTR") && ctx.s.players.bob.don.active >= 1
      && ctx.s.players.bob.zones.hand.some((iid) => (db(ctx.s.players.bob.instances[iid].cardId).counter ?? 0) > 0));
    const evIid = handIid(ctx, "bob", "ME-CTR")!;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    const counterCard = legalMoves(db, ctx.s).counterCards[0];
    run(ctx, [
      { type: "useCounter", player: "bob", cardIid: counterCard.iid, targetIid: leader(ctx, "bob") },
      { type: "useCounterEvent", player: "bob", cardIid: evIid },
      { type: "respondTargets", player: "bob", iids: [leader(ctx, "bob")] },
    ]);
    expect(effectivePower(db, ctx.s, "bob", leader(ctx, "bob"))).toBe(5000 + counterCard.amount + 2000);
    run(ctx, [{ type: "passCounter", player: "bob" }]);
    expect(ctx.s.modifiers).toHaveLength(0);
  });
});

// ─── trigger queue ordering (8-6) ────────────────────────────────────────────

describe("auto-effect queue (8-6)", () => {
  it("[When Attacking] (turn player) resolves before [On Your Opponent's Attack] (8-6-1, 10-2-16-1)", () => {
    const ctx = newCtx(ALICE_KW_DECK, BOB_KW_DECK);
    const ooa = playNow(ctx, "bob", "MC-OOA");
    const wa = playNow(ctx, "alice", "MC-WA");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[wa].rested
      && ctx.s.players.alice.instances[wa].playedOnTurn !== ctx.s.turn
      && ctx.s.players.bob.zones.characterArea.includes(ooa));
    const ev = run(ctx, [{ type: "attack", player: "alice", attackerIid: wa, targetIid: leader(ctx, "bob") }]);
    const activations = ev.filter((e) => e.type === "effectActivated");
    expect(activations.map((e) => e.type === "effectActivated" && e.player)).toEqual(["alice", "bob"]);
    // both powerMods applied: attacker 2000+2000, defender leader 5000+1000
    expect(effectivePower(db, ctx.s, "alice", wa)).toBe(4000);
    expect(effectivePower(db, ctx.s, "bob", leader(ctx, "bob"))).toBe(6000);
    run(ctx, [{ type: "passCounter", player: "bob" }]);
    // 4000 < 6000 → lost; thisBattle mods expired with the battle
    expect(ctx.s.modifiers).toHaveLength(0);
  });

  it("[On K.O.] queues during damage and resolves after it, before End of Battle (8-6-2, 10-2-17)", () => {
    const ctx = newCtx(ALICE_KW_DECK, BOB_KW_DECK);
    const ok = boardRested(ctx, "bob", "MC-OK");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested
      && ctx.s.players.bob.instances[ok].rested);
    const handBefore = ctx.s.players.bob.zones.hand.length;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: ok }]);
    const ev = run(ctx, [{ type: "passCounter", player: "bob" }]);
    const types = ev.map((e) => e.type);
    const koAt = types.indexOf("characterKOd");
    const drawAt = types.indexOf("cardsDrawn");
    const endAt = types.indexOf("battleEnded");
    expect(koAt).toBeGreaterThanOrEqual(0);
    expect(drawAt).toBeGreaterThan(koAt);   // resolves from the trash, after damage
    expect(endAt).toBeGreaterThan(drawAt);  // ...but before the battle ends
    expect(ctx.s.players.bob.zones.hand).toHaveLength(handBefore + 1);
  });
});

// ─── tier-1 executor via [On Play] ───────────────────────────────────────────

describe("tier-1 action executor", () => {
  it("koTarget with 'up to 1': choosing none is legal, choosing one K.O.s it (8-4-4-1)", () => {
    const ctx = newCtx(EFFECTS_DECK, VANILLA_DECK);
    const b1 = playNow(ctx, "bob", "MV-01");
    const b2 = playNow(ctx, "bob", "MV-02");
    // first copy: decline the optional target
    let ko = playNow(ctx, "alice", "MC-OPKO");
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "selectTargets", player: "alice", actionKind: "koTarget" });
    const pc = ctx.s.pendingChoice;
    if (pc?.kind === "selectTargets") {
      expect(pc.candidates.map((c) => c.iid).sort()).toEqual([b1, b2].sort());
      expect(() => applyIntent(db, ctx.s, { type: "respondTargets", player: "alice", iids: [b1, b2] }))
        .toThrow(/8-4-4-1/); // more than "up to 1"
    }
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [] }]);
    expect(ctx.s.players.bob.zones.characterArea).toEqual(expect.arrayContaining([b1, b2]));
    // second copy: K.O. one of them; [On K.O.]-less vanilla just dies
    ko = playNow(ctx, "alice", "MC-OPKO");
    expect(ko).toBeTruthy();
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [b1] }]);
    expect(ctx.s.players.bob.zones.trash).toContain(b1);
    expect(ctx.s.players.bob.zones.characterArea).not.toContain(b1);
  });

  it("discard chosen by the OPPONENT (sel.chooser, 10-2-14)", () => {
    const ctx = newCtx(EFFECTS_DECK, VANILLA_DECK);
    playNow(ctx, "alice", "MC-OPDISC");
    const pc = ctx.s.pendingChoice;
    expect(pc).toMatchObject({ kind: "selectTargets", player: "bob", actionKind: "discard" });
    if (pc?.kind !== "selectTargets") return;
    const pick = pc.candidates[0].iid;
    const handBefore = ctx.s.players.bob.zones.hand.length;
    run(ctx, [{ type: "respondTargets", player: "bob", iids: [pick] }]);
    expect(ctx.s.players.bob.zones.hand).toHaveLength(handBefore - 1);
    expect(ctx.s.players.bob.zones.trash).toContain(pick);
  });

  it("grantKeyword Rush (thisTurn) lets the card attack immediately; the grant expires at end of turn", () => {
    const ctx = newCtx(ALICE_KW_DECK, VANILLA_DECK);
    const gk = playNow(ctx, "alice", "MC-OPGK");
    expect(keywordsOf(db, ctx.s, "alice", gk).has("Rush")).toBe(true);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: gk, targetIid: leader(ctx, "bob") }]);
    drainToDamage(ctx);
    run(ctx, [{ type: "endTurn", player: "alice" }]);
    expect(keywordsOf(db, ctx.s, "alice", gk).has("Rush")).toBe(false); // 6-6-1-3
  });

  it("restriction cannotAttack blocks the attack until it expires (untilEndOfOpponentsNextTurn)", () => {
    const ctx = newCtx(EFFECTS_DECK, VANILLA_DECK);
    const bChar = playNow(ctx, "bob", "MV-01");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !!handIid(ctx, "alice", "MC-OPRES")
      && ctx.s.players.alice.don.active >= 2);
    run(ctx, [{ type: "playCard", player: "alice", iid: handIid(ctx, "alice", "MC-OPRES")! }]);
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [bChar] }]);
    expect(hasRestriction(db, ctx.s, "bob", bChar, "cannotAttack")).toBe(true);
    run(ctx, [{ type: "endTurn", player: "alice" }]); // → bob's turn (his char stood + no sickness)
    expect(() => applyIntent(db, ctx.s, { type: "attack", player: "bob", attackerIid: bChar, targetIid: leader(ctx, "alice") }))
      .toThrow(/cannot attack/);
    expect(legalMoves(db, ctx.s).attackers.some((a) => a.iid === bChar)).toBe(false);
    run(ctx, [{ type: "endTurn", player: "bob" }]); // restriction expires with bob's End Phase
    expect(hasRestriction(db, ctx.s, "bob", bChar, "cannotAttack")).toBe(false);
    until(ctx, () => ctx.s.turnPlayer === "bob");
    run(ctx, [{ type: "attack", player: "bob", attackerIid: bChar, targetIid: leader(ctx, "alice") }]);
    expect(ctx.s.battle).not.toBeNull();
    drainToDamage(ctx);
  });

  it("standTarget stands a rested character so it can attack again", () => {
    const ctx = newCtx(EFFECTS_DECK, VANILLA_DECK);
    const atk = boardRested(ctx, "alice", "MC-VAN"); // attacked once → rested
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.players.alice.instances[atk].rested
      && !!handIid(ctx, "alice", "MC-OPSTD") && ctx.s.players.alice.don.active >= 2);
    run(ctx, [{ type: "playCard", player: "alice", iid: handIid(ctx, "alice", "MC-OPSTD")! }]);
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [atk] }]);
    expect(ctx.s.players.alice.instances[atk].rested).toBe(false);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: atk, targetIid: leader(ctx, "bob") }]);
    drainToDamage(ctx);
  });

  it("restTarget rests an opposing character (making it attackable, 7-1-1-2)", () => {
    const ctx = newCtx(EFFECTS_DECK, VANILLA_DECK);
    const bChar = playNow(ctx, "bob", "MV-02");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !!handIid(ctx, "alice", "MC-OPREST")
      && ctx.s.players.alice.don.active >= 2 && !ctx.s.players.bob.instances[bChar].rested);
    run(ctx, [{ type: "playCard", player: "alice", iid: handIid(ctx, "alice", "MC-OPREST")! }]);
    run(ctx, [{ type: "respondTargets", player: "alice", iids: [bChar] }]);
    expect(ctx.s.players.bob.instances[bChar].rested).toBe(true);
  });

  it("optional auto effects pause on mayActivate; declining logs and skips (8-1-2)", () => {
    const ctx = newCtx(ALICE_KW_DECK, VANILLA_DECK);
    const wa = playNow(ctx, "alice", "MC-WAOPT");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[wa].rested
      && ctx.s.players.alice.instances[wa].playedOnTurn !== ctx.s.turn);
    const handBefore = ctx.s.players.alice.zones.hand.length;
    run(ctx, [{ type: "attack", player: "alice", attackerIid: wa, targetIid: leader(ctx, "bob") }]);
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "mayActivate", player: "alice" });
    const ev = run(ctx, [{ type: "respondMay", player: "alice", activate: false }]);
    expect(ev.some((e) => e.type === "effectDeclined")).toBe(true);
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore);
    drainToDamage(ctx);
    // second attack on a later turn: accept → draw
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[wa].rested);
    const handBefore2 = ctx.s.players.alice.zones.hand.length; // (hand changed by draws while waiting)
    run(ctx, [{ type: "attack", player: "alice", attackerIid: wa, targetIid: leader(ctx, "bob") }]);
    run(ctx, [{ type: "respondMay", player: "alice", activate: true }]);
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore2 + 1);
    drainToDamage(ctx);
  });

  it("unsupported actions degrade to manualResolve and the game continues (plan §1.3)", () => {
    const ctx = newCtx(EFFECTS_DECK, VANILLA_DECK);
    playNow(ctx, "alice", "MC-MANUAL");
    expect(ctx.s.pendingChoice).toMatchObject({ kind: "manualResolve", player: "alice" });
    const ev = run(ctx, [{ type: "ackManual", player: "alice" }]);
    expect(ev.some((e) => e.type === "manualResolved")).toBe(true);
    expect(ctx.s.pendingChoice).toBeNull();
    expect(ctx.s.exec).toBeNull();
    run(ctx, [{ type: "endTurn", player: "alice" }]); // engine healthy
  });

  it("a [Main] event resolves its effect; a [Counter]-only event is not playable in main (10-2-3/10-2-4)", () => {
    const ctx = newCtx(EFFECTS_DECK, BOB_KW_DECK);
    until(ctx, () => ctx.s.turnPlayer === "alice" && ctx.s.turn > 2
      && !!handIid(ctx, "alice", "ME-MAIN") && ctx.s.players.alice.don.active >= 1);
    const me = handIid(ctx, "alice", "ME-MAIN")!;
    const handBefore = ctx.s.players.alice.zones.hand.length;
    run(ctx, [{ type: "playCard", player: "alice", iid: me }]);
    expect(ctx.s.players.alice.zones.trash).toContain(me);
    expect(ctx.s.players.alice.zones.hand).toHaveLength(handBefore); // -1 event, +1 drawn
    // bob side: ME-CTR in HIS hand is not playable during his main phase
    until(ctx, () => ctx.s.turnPlayer === "bob" && !!handIid(ctx, "bob", "ME-CTR")
      && ctx.s.players.bob.don.active >= 1);
    expect(() => applyIntent(db, ctx.s, { type: "playCard", player: "bob", iid: handIid(ctx, "bob", "ME-CTR")! }))
      .toThrow(/10-2-3/);
    expect(legalMoves(db, ctx.s).playableFromHand.some((p) => p.iid === handIid(ctx, "bob", "ME-CTR"))).toBe(false);
  });
});

// ─── replay determinism with M1 events ───────────────────────────────────────

describe("replay determinism (M1 events)", () => {
  it("folding applyEvent over a log with blocks, counters and triggers reproduces the state", () => {
    const config: GameConfig = {
      seed: "m1-replay",
      players: [
        { id: "alice", leader: "ML-A", deck: ALICE_KW_DECK },
        { id: "bob", leader: "ML-B", deck: BOB_KW_DECK },
      ],
      firstPlayer: "alice",
    };
    const a = createGame(db, config);
    const ctx: Ctx = { s: a.state, log: [...a.events] };
    run(ctx, [
      { type: "respondMulligan", player: "alice", take: false },
      { type: "respondMulligan", player: "bob", take: true },
    ]);
    // a few turns of real play with whatever the hands allow
    const blk = playNow(ctx, "bob", "MC-BLK");
    until(ctx, () => ctx.s.turnPlayer === "alice" && !ctx.s.players.alice.instances[leader(ctx, "alice")].rested);
    run(ctx, [{ type: "attack", player: "alice", attackerIid: leader(ctx, "alice"), targetIid: leader(ctx, "bob") }]);
    run(ctx, [{ type: "respondBlock", player: "bob", blockerIid: blk }]);
    const cc = legalMoves(db, ctx.s).counterCards[0];
    if (cc) run(ctx, [{ type: "useCounter", player: "bob", cardIid: cc.iid, targetIid: blk }]);
    run(ctx, [{ type: "passCounter", player: "bob" }]);
    drainToDamage(ctx);

    const b = createGame(db, config);
    const replayed = structuredClone(b.state);
    for (const e of ctx.log.slice(b.events.length)) applyEvent(replayed, e);
    // pendingChoice/rngUses/exec are engine bookkeeping, not event-derived
    replayed.pendingChoice = ctx.s.pendingChoice;
    replayed.rngUses = ctx.s.rngUses;
    replayed.exec = structuredClone(ctx.s.exec);
    expect(replayed).toEqual(ctx.s);
  });
});

// ─── M1 EXIT CRITERION ───────────────────────────────────────────────────────

describe("M1 exit: starter vs starter with every keyword window, to a victory", () => {
  it("scripted hotseat game exercising Rush, Blocker, Double Attack, counter value, [Counter] event, [Trigger] activated and declined", () => {
    const aliceDeck = deckOf([
      ["MC-RUSH", 4], ["MC-DA", 4], ["MC-VAN", 4], ...mv(9), ["MV-10", 2],
    ]);
    const bobDeck = deckOf([
      ["MC-BLK", 4], ["MC-VAN", 4], ["ME-CTR", 4],
      ...Array.from({ length: 5 }, (_, i) => [`MT-0${i + 1}`, 4] as [string, number]),
      ...Array.from({ length: 4 }, (_, i) => [`MP-0${i + 1}`, 4] as [string, number]),
      ["MT-06", 2],
    ]);
    const ctx = newCtx(aliceDeck, bobDeck, { seed: "m1-exit" });
    const bobLeader = leader(ctx, "bob");

    const used = {
      rush: false, blocker: false, doubleAttack: false,
      counterValue: false, counterEvent: false,
      triggerActivated: false, triggerDeclined: false,
    };
    let blockersPlayed = 0;

    let guard = 800;
    while (ctx.s.phase !== "over" && guard-- > 0) {
      const s = ctx.s;
      const pc = s.pendingChoice;

      if (pc) {
        switch (pc.kind) {
          case "blockWindow": {
            const block = !used.blocker ? pc.blockers[0] : null;
            if (block) used.blocker = true;
            run(ctx, [{ type: "respondBlock", player: pc.player, blockerIid: block }]);
            break;
          }
          case "counterWindow": {
            const lm = legalMoves(db, s);
            if (!used.counterValue && lm.counterCards.length > 0 && s.battle) {
              used.counterValue = true;
              run(ctx, [{ type: "useCounter", player: pc.player, cardIid: lm.counterCards[0].iid, targetIid: s.battle.targetIid }]);
            } else if (!used.counterEvent && lm.counterEvents.length > 0) {
              used.counterEvent = true;
              run(ctx, [{ type: "useCounterEvent", player: pc.player, cardIid: lm.counterEvents[0].iid }]);
            } else {
              run(ctx, [{ type: "passCounter", player: pc.player }]);
            }
            break;
          }
          case "triggerDecision": {
            const activate = used.triggerDeclined && !used.triggerActivated;
            if (activate) used.triggerActivated = true;
            else used.triggerDeclined = true;
            run(ctx, [{ type: "respondTrigger", player: pc.player, activate }]);
            break;
          }
          case "selectTargets": {
            const n = Math.min(pc.count, pc.candidates.length);
            run(ctx, [{ type: "respondTargets", player: pc.player, iids: pc.candidates.slice(0, n).map((c) => c.iid) }]);
            break;
          }
          case "mayActivate":
            run(ctx, [{ type: "respondMay", player: pc.player, activate: true }]);
            break;
          case "manualResolve":
            run(ctx, [{ type: "ackManual", player: pc.player }]);
            break;
          default:
            throw new Error(`unexpected choice ${pc.kind}`);
        }
        continue;
      }

      if (s.turnPlayer === "alice") {
        const p = s.players.alice;
        if (s.turn === 1) { run(ctx, [{ type: "endTurn", player: "alice" }]); continue; }
        // develop: Double Attack body, then Rush bodies
        const da = handIid(ctx, "alice", "MC-DA");
        if (da && p.don.active >= 2 && p.zones.characterArea.length < 5) {
          run(ctx, [{ type: "playCard", player: "alice", iid: da }]);
          continue;
        }
        const rush = handIid(ctx, "alice", "MC-RUSH");
        if (rush && p.don.active >= 1 && p.zones.characterArea.length < 5) {
          run(ctx, [{ type: "playCard", player: "alice", iid: rush }]);
          continue;
        }
        // attack bob's leader — but hold the aggression until the Rush and
        // Double Attack flags have been exercised, so the game can't end first
        const candidates = legalMoves(db, s).attackers.filter((x) => x.targets.includes(bobLeader));
        const atk = candidates.find((x) => {
          const inst = p.instances[x.iid];
          if (!used.rush) return inst.playedOnTurn === s.turn;          // a fresh [Rush] attacker only
          if (!used.doubleAttack) return inst.cardId === "MC-DA" || inst.playedOnTurn === s.turn;
          return true;
        });
        if (atk) {
          const inst = p.instances[atk.iid];
          if (inst.playedOnTurn === s.turn) used.rush = true; // a fresh [Rush] attacker
          if (inst.cardId === "MC-DA") used.doubleAttack = true;
          run(ctx, [{ type: "attack", player: "alice", attackerIid: atk.iid, targetIid: bobLeader }]);
          continue;
        }
        run(ctx, [{ type: "endTurn", player: "alice" }]);
        continue;
      }

      // bob: keep a blocker on the table, otherwise pass
      const bp = ctx.s.players.bob;
      const blk = handIid(ctx, "bob", "MC-BLK");
      if (blk && blockersPlayed < 2 && bp.don.active >= 1 && bp.zones.characterArea.length < 5) {
        blockersPlayed++;
        run(ctx, [{ type: "playCard", player: "bob", iid: blk }]);
        continue;
      }
      run(ctx, [{ type: "endTurn", player: "bob" }]);
    }

    expect(ctx.s.phase).toBe("over");
    expect(ctx.s.winner).toBe("alice");
    expect(["leaderDamageAtZeroLife", "deckOut"]).toContain(ctx.s.winReason);
    expect(used).toEqual({
      rush: true, blocker: true, doubleAttack: true,
      counterValue: true, counterEvent: true,
      triggerActivated: true, triggerDeclined: true,
    });
    // the mechanics actually left their marks in the event log
    const types = ctx.log.map((e) => e.type);
    expect(types).toContain("blockWindowResolved");
    expect(types).toContain("counterApplied");
    expect(types).toContain("triggerActivated");
    expect(types).toContain("eventCardUsed");
    expect(ctx.log.some((e) => e.type === "gameEnded")).toBe(true);
  });
});
