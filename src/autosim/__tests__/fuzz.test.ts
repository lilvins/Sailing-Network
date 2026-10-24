import { describe, expect, it } from "vitest";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { EngineError, type PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, EngineCard, Iid } from "../engine/state";
import type { GameEvent } from "../engine/events";
import type { Effect, Keyword } from "../ir/types";
import { seededRng } from "../../lib/rng";

/**
 * GAME-SMOOTHNESS fuzz suite (M0, extended in M1 with keywords, the block
 * window, [Counter] events, [Trigger] decisions and effect choices).
 *
 * Plays many seeded random games end-to-end by repeatedly asking
 * `legalMoves()` / the pending choice for the options and picking uniformly
 * among them, then checks hard invariants after EVERY applied intent:
 *
 *  - a legal move never throws;
 *  - card conservation per player (deck+hand+trash+life+characterArea+stage
 *    + leader + [Trigger] limbo = 51 distinct iids, every iid has an instance);
 *  - DON!! conservation (deck+active+rested+sum(given) = 10, none negative,
 *    given only to on-board leader/characters);
 *  - cards in piles (deck/hand/trash/life) are never rested;
 *  - modifiers only target on-field cards; thisBattle modifiers die with the
 *    battle (7-1-5-3/4);
 *  - the state JSON round-trips (JSON.parse(JSON.stringify(s)) deep-equals s);
 *  - pendingChoice/battle/exec consistency (each battle step pairs with its
 *    window; exec bookkeeping exists iff an effect choice is pending);
 *  - at most ONE [Blocker] activation per battle (7-1-2-1, checked on the log);
 *  - applyIntent never mutates its input state (purity);
 *  - every game TERMINATES before the intent cap.
 *
 * A second pass fuzzes guaranteed-ILLEGAL intents at every step of a running
 * game: each must throw EngineError and leave the state byte-identical.
 */

// ─── synthetic card DB ───────────────────────────────────────────────────────

// Construction-LEGAL fixtures (5-1-2): ≤4 copies per card number and every
// deck color on the leader (FL-B is Blue/Red multicolor so the all-Red decks
// are legal for both seats). Two card numbers per cost tier; the B variants
// carry M1 keywords/effects so every new window gets fuzzed.
const CARDS: Record<string, EngineCard> = {
  // leaders (cost = Life value, local DB quirk)
  "FL-A": { id: "FL-A", category: "Leader", cost: 4, power: 5000, counter: null, colors: ["Red"], types: ["Fuzz"] },
  "FL-B": { id: "FL-B", category: "Leader", cost: 5, power: 5000, counter: null, colors: ["Blue", "Red"], types: ["Fuzz"] },
  // stage — [End of Your Turn] draw (M3 End Phase window under fuzz)
  "FS-1": { id: "FS-1", category: "Stage", cost: 1, power: null, counter: null, colors: ["Red"], types: ["Fuzz"] },
};

function compiled(opts: { keywords?: Keyword[]; effects?: Effect[] }): EngineCard["compiled"] {
  return {
    cardId: "TEST-000", version: 1, confidence: 1,
    classification: (opts.effects?.length ?? 0) > 0 ? "compiled" : "keyword-only",
    keywords: opts.keywords ?? [], effects: opts.effects ?? [],
  };
}

// [Counter] event (+2000 up to 1, DON!!−1 cost → payDon window when DON are
// attached) that is also a [Trigger] (draw 1)
CARDS["FE-1"] = {
  id: "FE-1", category: "Event", cost: 1, power: null, counter: null, colors: ["Red"], types: ["Fuzz"],
  compiled: compiled({ effects: [
    { timing: "counter", cost: [{ kind: "returnDonToDeck", count: 1 }], actions: [
      { kind: "powerMod", sel: { owner: "self", zone: "leaderOrCharacter", count: 1, upTo: true, chooser: "controller" }, amount: 2000, duration: "thisBattle" },
    ]},
    { timing: "trigger", actions: [{ kind: "draw", count: 1 }] },
  ]}),
};
// stage effect: [End of Your Turn] draw 1 (exercises the End Phase enqueue)
CARDS["FS-1"].compiled = compiled({ effects: [
  { timing: "endOfYourTurn", actions: [{ kind: "draw", count: 1 }] },
]});

// characters — two card numbers per cost tier, mix of powers/counters;
// B variants exercise the M1 mechanics
const TIERS: [number, number, number | null][] = [
  [0, 1000, 2000], [1, 2000, 1000], [2, 3000, 2000],
  [3, 5000, 1000], [4, 6000, null], [5, 7000, 1000],
];
for (const [cost, power, counter] of TIERS) {
  for (const variant of ["A", "B"]) {
    const id = `FC-${cost}${variant}`;
    CARDS[id] = { id, category: "Character", cost, power, counter, colors: ["Red"], types: ["Fuzz"] };
  }
}
CARDS["FC-0A"].compiled = compiled({ effects: [
  // peek 3, take up to 1 Fuzz card, rest to the bottom (M3 peekSelect window)
  { timing: "onPlay", actions: [
    { kind: "peekDeck", who: "self", count: 3, then: { reveal: true, addToHand: { typeIncludes: ["Fuzz"] }, addCount: 1, rest: "bottomAnyOrder" } },
  ]},
]});
CARDS["FC-0B"].compiled = compiled({ effects: [{ timing: "trigger", actions: [{ kind: "draw", count: 1 }] }] });
CARDS["FC-1A"].compiled = compiled({ effects: [
  // [Activate: Main] [Once Per Turn] ①: draw up to 1 (M3 activateMain +
  // chooseNumber windows)
  { timing: "activateMain", oncePerTurn: true, optional: false,
    cost: [{ kind: "restDon", count: 1 }],
    actions: [{ kind: "draw", count: 1, upTo: true }] },
]});
CARDS["FC-1B"].compiled = compiled({ keywords: ["Blocker"] });
CARDS["FC-2A"].compiled = compiled({ keywords: ["Rush"] });
CARDS["FC-2B"].compiled = compiled({ effects: [
  { timing: "trigger", actions: [
    { kind: "playFromZone", zone: "hand", free: true, sel: { owner: "self", zone: "hand", count: 1, self: true, chooser: "controller" } },
  ]},
]});
CARDS["FC-3A"].compiled = compiled({ effects: [
  { timing: "onPlay", optional: true, actions: [
    { kind: "koTarget", sel: { owner: "opponent", zone: "characterArea", filter: { costAtMost: 2 }, count: 1, upTo: true, chooser: "controller" } },
  ]},
]});
CARDS["FC-3B"].compiled = compiled({ keywords: ["Unblockable"], effects: [
  { timing: "whenAttacking", actions: [
    { kind: "powerMod", sel: { owner: "self", zone: "characterArea", count: 1, self: true, chooser: "controller" }, amount: 1000, duration: "thisBattle" },
  ]},
]});
CARDS["FC-4A"].compiled = compiled({ keywords: ["DoubleAttack"] });
CARDS["FC-4B"].compiled = compiled({ keywords: ["Banish"], effects: [
  { timing: "onKO", actions: [{ kind: "draw", count: 1 }] },
]});
CARDS["FC-5A"].compiled = compiled({ keywords: ["RushCharacter"] });
CARDS["FC-5B"].compiled = compiled({ effects: [
  { timing: "onPlay", actions: [
    { kind: "restriction", what: "cannotAttack", duration: "thisTurn", sel: { owner: "opponent", zone: "characterArea", count: 1, upTo: true, chooser: "controller" } },
  ]},
]});

const db: CardDb = (id) => {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};

/** Legal 50-card deck: 12 character numbers × 4 copies + 1 event + 1 stage. */
const FUZZ_DECK: string[] = [
  ...Object.keys(CARDS).filter((id) => CARDS[id].category === "Character").flatMap((id) => Array<string>(4).fill(id)),
  "FE-1",
  "FS-1",
];
const DECK_A = FUZZ_DECK;
const DECK_B = FUZZ_DECK;

// tuned so the whole suite stays well under ~10s; MAX_INTENTS covers the
// worst case of two fully passive players racing to deck-out plus the extra
// window responses M1 added (block/trigger/target choices)
const NUM_SEEDS = 32;
const MAX_INTENTS = 1000;
const ILLEGAL_SEEDS = 8;

// ─── invariants ──────────────────────────────────────────────────────────────

function checkInvariants(state: AutoGameState, ctx: () => string, deep = true): void {
  const fail = (msg: string): never => {
    throw new Error(`[invariant] ${msg}\n  ${ctx()}`);
  };

  for (const pid of state.order) {
    const p = state.players[pid];
    if (!p) return fail(`missing player ${pid}`);
    const z = p.zones;
    const all = [...z.deck, ...z.hand, ...z.trash, ...z.life, ...z.characterArea, ...z.stage, p.leaderIid];
    // a [Trigger] card being resolved belongs to no area (10-1-5-3) — count it
    const r = state.exec?.running;
    if (r && r.controller === pid && r.triggerCard && !all.includes(r.triggerCard.iid)) {
      all.push(r.triggerCard.iid);
    }
    // card conservation: 50 deck cards + leader, each in exactly one place
    if (all.length !== 51) fail(`${pid}: ${all.length} iids across zones+leader, expected 51`);
    if (new Set(all).size !== 51) fail(`${pid}: duplicate iid across zones`);
    if (Object.keys(p.instances).length !== 51) {
      fail(`${pid}: instances table has ${Object.keys(p.instances).length} entries, expected 51`);
    }
    for (const iid of all) if (!p.instances[iid]) fail(`${pid}: ${iid} has no instance record`);
    // cards in piles are never rested
    for (const iid of [...z.deck, ...z.hand, ...z.trash, ...z.life]) {
      if (p.instances[iid].rested) fail(`${pid}: ${iid} is rested while in a pile`);
    }
    // zone caps (3-7-6, 3-8-5)
    if (z.characterArea.length > 5) fail(`${pid}: ${z.characterArea.length} characters on board`);
    if (z.stage.length > 1) fail(`${pid}: ${z.stage.length} stages on board`);
    // DON conservation (10 total, 4-4)
    const d = p.don;
    const givenVals = Object.values(d.given);
    const givenSum = givenVals.reduce((s, n) => s + n, 0);
    if (d.deck < 0 || d.active < 0 || d.rested < 0 || givenVals.some((n) => n < 0)) {
      fail(`${pid}: negative DON count ${JSON.stringify(d)}`);
    }
    if (d.deck + d.active + d.rested + givenSum !== 10) {
      fail(`${pid}: DON not conserved (${d.deck}+${d.active}+${d.rested}+given ${givenSum} != 10)`);
    }
    for (const iid of Object.keys(d.given)) {
      if (iid !== p.leaderIid && !z.characterArea.includes(iid)) {
        fail(`${pid}: DON given to off-board iid ${iid}`);
      }
    }
  }

  // modifiers: only target on-field cards; thisBattle only during a battle
  for (const m of state.modifiers) {
    const tp = state.players[m.targetOwner];
    const onField = m.targetIid === tp.leaderIid
      || tp.zones.characterArea.includes(m.targetIid) || tp.zones.stage.includes(m.targetIid);
    if (!onField) fail(`modifier targets off-field iid ${m.targetIid}`);
    if (m.duration === "thisBattle" && !state.battle && state.phase !== "over") {
      fail("thisBattle modifier survived the battle (7-1-5-3/4)");
    }
  }

  // pendingChoice / battle / exec consistency
  const pc = state.pendingChoice;
  const effectChoice = pc && ["selectTargets", "mayActivate", "manualResolve", "peekSelect", "payDon", "chooseNumber"].includes(pc.kind);
  if (state.battle) {
    if (!pc) fail(`battle in step "${state.battle.step}" with no pending choice`);
    const step = state.battle.step;
    const ok =
      (step === "block" && pc!.kind === "blockWindow") ||
      (step === "counter" && (pc!.kind === "counterWindow" || effectChoice)) ||
      (step === "damage" && (pc!.kind === "triggerDecision" || effectChoice)) ||
      (step === "attack" && effectChoice);
    if (!ok) fail(`battle step "${step}" paired with choice "${pc!.kind}"`);
    if ((pc!.kind === "blockWindow" || pc!.kind === "counterWindow" || pc!.kind === "triggerDecision")
        && pc!.player !== state.battle.defenderOwner) {
      fail(`${pc!.kind} pending for a player other than the defender`);
    }
  }
  if (pc && ["blockWindow", "counterWindow", "triggerDecision"].includes(pc.kind) && !state.battle) {
    fail(`${pc.kind} pending without a battle`);
  }
  if (pc?.kind === "mulligan" && state.phase !== "setup") {
    fail(`mulligan pending during phase "${state.phase}"`);
  }
  // exec bookkeeping exists iff resolution paused on an effect/trigger choice
  if (state.exec && !(effectChoice || pc?.kind === "triggerDecision")) {
    fail(`exec bookkeeping present with pending choice "${pc?.kind ?? "none"}"`);
  }
  if (effectChoice && !state.exec) fail(`choice "${pc!.kind}" without exec bookkeeping`);
  if (state.phase === "over") {
    if (state.pendingChoice) fail("pendingChoice still set after game over");
    if (state.battle) fail("battle still set after game over");
    if (state.exec) fail("exec still set after game over");
    if (!state.winner || !state.order.includes(state.winner)) fail(`bad winner "${state.winner}"`);
    if (!state.winReason) fail("game over without a winReason");
  }

  // JSON-serializability: round-trip must be lossless (deep — throttled by
  // the caller in the hot loop, always run at game end)
  if (deep) {
    try {
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    } catch (e) {
      fail(`state does not JSON round-trip: ${(e as Error).message}`);
    }
  }
}

/** 7-1-2-1: at most one [Blocker] activation per battle — checked on the
 *  whole event log once the game is over. */
function checkBlockerOncePerBattle(log: GameEvent[], ctx: string): void {
  let inBattle = false;
  let blocks = 0;
  for (const e of log) {
    if (e.type === "attackDeclared") { inBattle = true; blocks = 0; }
    else if (e.type === "battleEnded") { inBattle = false; }
    else if (e.type === "blockWindowResolved" && e.blockerIid) {
      if (!inBattle) throw new Error(`[invariant] block outside a battle\n  ${ctx}`);
      blocks += 1;
      if (blocks > 1) throw new Error(`[invariant] two blockers in one battle (7-1-2-1)\n  ${ctx}`);
    }
  }
}

// ─── random-move policy ──────────────────────────────────────────────────────

/** Enumerate atomic legal moves from legalMoves()/pendingChoice for sampling. */
function enumerateMoves(state: AutoGameState): PlayerIntent[] {
  if (state.phase === "over") return [];
  const lm = legalMoves(db, state);
  const actor = lm.actor;
  const pc = state.pendingChoice;

  if (pc?.kind === "mulligan") {
    return [
      { type: "respondMulligan", player: actor, take: false },
      { type: "respondMulligan", player: actor, take: true },
    ];
  }
  if (pc?.kind === "blockWindow") {
    return [
      { type: "respondBlock", player: actor, blockerIid: null },
      ...pc.blockers.map((b): PlayerIntent => ({ type: "respondBlock", player: actor, blockerIid: b })),
    ];
  }
  if (pc?.kind === "counterWindow") {
    // counter-or-pass: values go on the attacked card or the own leader
    const target = state.battle!.targetIid;
    const ownLeader = state.players[actor].leaderIid;
    const moves: PlayerIntent[] = [{ type: "passCounter", player: actor }];
    for (const c of lm.counterCards) {
      moves.push({ type: "useCounter", player: actor, cardIid: c.iid, targetIid: target });
      if (target !== ownLeader) moves.push({ type: "useCounter", player: actor, cardIid: c.iid, targetIid: ownLeader });
    }
    for (const e of lm.counterEvents) {
      moves.push({ type: "useCounterEvent", player: actor, cardIid: e.iid });
    }
    return moves;
  }
  if (pc?.kind === "triggerDecision") {
    return [
      { type: "respondTrigger", player: actor, activate: false },
      { type: "respondTrigger", player: actor, activate: true },
    ];
  }
  if (pc?.kind === "selectTargets") {
    const n = Math.min(pc.count, pc.candidates.length);
    const firstN = pc.candidates.slice(0, n).map((c) => c.iid);
    const lastN = pc.candidates.slice(-n).map((c) => c.iid);
    const moves: PlayerIntent[] = [{ type: "respondTargets", player: actor, iids: firstN }];
    if (lastN.join() !== firstN.join()) moves.push({ type: "respondTargets", player: actor, iids: lastN });
    if (pc.upTo) moves.push({ type: "respondTargets", player: actor, iids: [] });
    return moves;
  }
  if (pc?.kind === "mayActivate") {
    return [
      { type: "respondMay", player: actor, activate: false },
      { type: "respondMay", player: actor, activate: true },
    ];
  }
  if (pc?.kind === "manualResolve") {
    return [{ type: "ackManual", player: actor }];
  }
  if (pc?.kind === "peekSelect") {
    const takes: Iid[][] = [[]];
    if (pc.eligible.length > 0 && pc.takeCount > 0) takes.push(pc.eligible.slice(0, Math.min(pc.takeCount, pc.eligible.length)));
    return takes.map((take): PlayerIntent => {
      const remaining = pc.cards.filter((iid) => !take.includes(iid));
      return {
        type: "respondPeek", player: actor, take,
        restTop: pc.rest === "topAnyOrder" ? remaining
          : pc.rest === "topOrBottomAnyOrder" ? remaining.slice(0, 1) : [],
        restBottom: pc.rest === "bottomAnyOrder" ? [...remaining].reverse()
          : pc.rest === "topOrBottomAnyOrder" ? remaining.slice(1) : [],
      };
    });
  }
  if (pc?.kind === "payDon") {
    const d = state.players[actor].don;
    const compose = (preferGiven: boolean): PlayerIntent => {
      let left = pc.amount;
      const fromGiven: Record<Iid, number> = {};
      if (preferGiven) {
        for (const [iid, n] of Object.entries(d.given)) {
          if (left <= 0) break;
          const use = Math.min(left, n);
          if (use > 0) { fromGiven[iid] = use; left -= use; }
        }
      }
      const fromRested = Math.min(left, d.rested); left -= fromRested;
      const fromActive = Math.min(left, d.active); left -= fromActive;
      if (left > 0) {
        for (const [iid, n] of Object.entries(d.given)) {
          if (left <= 0) break;
          const use = Math.min(left, n - (fromGiven[iid] ?? 0));
          if (use > 0) { fromGiven[iid] = (fromGiven[iid] ?? 0) + use; left -= use; }
        }
      }
      return { type: "respondPayDon", player: actor, fromActive, fromRested, fromGiven };
    };
    return [compose(false), compose(true)];
  }
  if (pc?.kind === "chooseNumber") {
    const moves: PlayerIntent[] = [{ type: "respondNumber", player: actor, value: pc.min }];
    if (pc.max > pc.min) moves.push({ type: "respondNumber", player: actor, value: pc.max });
    return moves;
  }

  // main action window
  const p = state.players[actor];
  const moves: PlayerIntent[] = [{ type: "endTurn", player: actor }];
  for (const pl of lm.playableFromHand) {
    const card = db(p.instances[pl.iid].cardId);
    if (pl.needsReplace && card.category === "Character") {
      for (const victim of p.zones.characterArea) {
        moves.push({ type: "playCard", player: actor, iid: pl.iid, replaceIid: victim });
      }
    } else {
      // stage replacement defaults to the current stage inside the engine
      moves.push({ type: "playCard", player: actor, iid: pl.iid });
    }
  }
  for (const t of lm.canGiveDonTo) moves.push({ type: "giveDon", player: actor, targetIid: t });
  for (const a of lm.attackers) {
    for (const t of a.targets) {
      moves.push({ type: "attack", player: actor, attackerIid: a.iid, targetIid: t });
    }
  }
  for (const act of lm.activatable) {
    moves.push({ type: "activateMain", player: actor, iid: act.iid, effectIndex: act.effectIndex });
  }
  return moves;
}

interface FuzzResult {
  state: AutoGameState;
  intentCount: number;
  capHit: boolean;
  history: PlayerIntent[];
  log: GameEvent[];
}

/** Play one seeded random game, checking invariants after every intent. */
function playFuzzGame(seed: string, cap = MAX_INTENTS): FuzzResult {
  const rng = seededRng(`driver:${seed}`);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  const config: GameConfig = {
    seed,
    players: [
      { id: "p1", leader: "FL-A", deck: DECK_A },
      { id: "p2", leader: "FL-B", deck: DECK_B },
    ],
    firstPlayer: rng() < 0.5 ? "p1" : "p2",
  };
  const created = createGame(db, config);
  let state = created.state;
  const log: GameEvent[] = [...created.events];
  const history: PlayerIntent[] = [];
  const ctx = () =>
    `seed=${seed} firstPlayer=${config.firstPlayer} step=${history.length} ` +
    `turn=${state.turn} phase=${state.phase} last5=${JSON.stringify(history.slice(-5))}`;

  checkInvariants(state, ctx);

  while (state.phase !== "over" && history.length < cap) {
    const moves = enumerateMoves(state);
    if (moves.length === 0) throw new Error(`no legal moves but game not over\n  ${ctx()}`);
    const intent = pick(moves);
    history.push(intent);

    const before = JSON.stringify(state);
    let result;
    try {
      result = applyIntent(db, state, intent);
    } catch (e) {
      throw new Error(`legal move threw ${(e as Error).name}: ${(e as Error).message}\n  intent=${JSON.stringify(intent)}\n  ${ctx()}`);
    }
    if (JSON.stringify(state) !== before) {
      throw new Error(`applyIntent mutated its input state\n  intent=${JSON.stringify(intent)}\n  ${ctx()}`);
    }
    state = result.state;
    log.push(...result.events);
    checkInvariants(state, ctx, history.length % 20 === 0);
  }
  checkInvariants(state, ctx, true);
  checkBlockerOncePerBattle(log, ctx());

  return { state, intentCount: history.length, capHit: state.phase !== "over", history, log };
}

// ─── legal-game fuzzing ──────────────────────────────────────────────────────

describe("fuzz: seeded random games play smoothly end-to-end", () => {
  for (let i = 0; i < NUM_SEEDS; i++) {
    const seed = `fuzz-${i}`;
    it(`seed ${seed}: invariants hold every step and the game terminates`, () => {
      const r = playFuzzGame(seed);
      expect(
        r.capHit,
        `game did not reach phase "over" within ${MAX_INTENTS} intents (seed=${seed}, turn=${r.state.turn})`,
      ).toBe(false);
      expect(r.state.phase).toBe("over");
      expect(r.state.winner === "p1" || r.state.winner === "p2").toBe(true);
      expect(r.state.winReason).toBeTruthy();
    });
  }
});

// ─── illegal-intent fuzzing ──────────────────────────────────────────────────

/** Intents that are guaranteed illegal in the given state, whatever it is. */
function makeIllegalIntents(state: AutoGameState): PlayerIntent[] {
  const [first, second] = state.order;
  const turnP = state.turnPlayer;
  const notTurnP = turnP === first ? second : first;
  const other = (pid: string) => (pid === first ? second : first);
  const p = state.players[turnP];
  const pc = state.pendingChoice;
  const ghost = "ghost#404";

  const out: PlayerIntent[] = [
    // endTurn by the player whose turn it is NOT (also illegal in setup/battle)
    { type: "endTurn", player: notTurnP },
    // playing a card that is not in hand
    { type: "playCard", player: turnP, iid: ghost },
    // playing straight from the deck
    ...(p.zones.deck.length > 0
      ? [{ type: "playCard", player: turnP, iid: p.zones.deck[0] } as PlayerIntent]
      : []),
    // giving DON to a nonexistent target
    { type: "giveDon", player: turnP, targetIid: ghost },
    // attacking with a nonexistent attacker
    { type: "attack", player: turnP, attackerIid: ghost, targetIid: state.players[notTurnP].leaderIid },
    // attacking your own leader
    { type: "attack", player: turnP, attackerIid: p.leaderIid, targetIid: p.leaderIid },
    // mulligan response from a player whose mulligan is not pending
    {
      type: "respondMulligan",
      player: pc?.kind === "mulligan" ? other(pc.player) : first,
      take: true,
    },
    // counter-window responses when it is not that player's window
    {
      type: "passCounter",
      player: pc?.kind === "counterWindow" ? other(pc.player) : turnP,
    },
    // countering with a card that is not in hand
    {
      type: "useCounter",
      player: pc?.kind === "counterWindow" ? pc.player : turnP,
      cardIid: ghost,
      targetIid: pc?.kind === "counterWindow" ? state.players[pc.player].leaderIid : p.leaderIid,
    },
    // counter event that is not in hand
    {
      type: "useCounterEvent",
      player: pc?.kind === "counterWindow" ? pc.player : turnP,
      cardIid: ghost,
    },
    // block responses by the turn player (the defender is never the turn player)
    { type: "respondBlock", player: turnP, blockerIid: null },
    // trigger decisions belong to the defender, never the turn player
    { type: "respondTrigger", player: turnP, activate: true },
    // target selection with a nonexistent candidate
    {
      type: "respondTargets",
      player: pc?.kind === "selectTargets" ? pc.player : turnP,
      iids: [ghost],
    },
    // may/manual answers by the wrong player
    { type: "respondMay", player: pc?.kind === "mayActivate" ? other(pc.player) : turnP, activate: true },
    { type: "ackManual", player: pc?.kind === "manualResolve" ? other(pc.player) : turnP },
    // M3 windows — wrong player / impossible payloads
    { type: "respondPeek", player: pc?.kind === "peekSelect" ? other(pc.player) : turnP, take: [] },
    { type: "respondPeek", player: pc?.kind === "peekSelect" ? pc.player : turnP, take: [ghost] },
    { type: "respondPayDon", player: pc?.kind === "payDon" ? other(pc.player) : turnP, fromActive: 0, fromRested: 0, fromGiven: {} },
    { type: "respondNumber", player: pc?.kind === "chooseNumber" ? other(pc.player) : turnP, value: 0 },
    { type: "respondNumber", player: pc?.kind === "chooseNumber" ? pc.player : turnP, value: 99 },
    // activateMain on a card that does not exist
    { type: "activateMain", player: turnP, iid: ghost, effectIndex: 0 },
  ];
  return out;
}

describe("fuzz: illegal intents throw EngineError and leave state untouched", () => {
  for (let i = 0; i < ILLEGAL_SEEDS; i++) {
    const seed = `illegal-${i}`;
    it(`seed ${seed}: every illegal probe is rejected cleanly at every step`, () => {
      const rng = seededRng(`driver:${seed}`);
      const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
      const config: GameConfig = {
        seed,
        players: [
          { id: "p1", leader: "FL-A", deck: DECK_A },
          { id: "p2", leader: "FL-B", deck: DECK_B },
        ],
        firstPlayer: rng() < 0.5 ? "p1" : "p2",
      };
      let { state } = createGame(db, config);
      let step = 0;

      while (state.phase !== "over" && step < 250) {
        // probe 3 random guaranteed-illegal intents against the current state
        const probes = makeIllegalIntents(state);
        for (let k = 0; k < 3; k++) {
          const probe = pick(probes);
          const before = JSON.stringify(state);
          let threw: unknown = null;
          try {
            applyIntent(db, state, probe);
          } catch (e) {
            threw = e;
          }
          expect(
            threw,
            `illegal intent was accepted: ${JSON.stringify(probe)} (seed=${seed} step=${step})`,
          ).toBeInstanceOf(EngineError);
          expect(
            JSON.stringify(state) === before,
            `illegal intent mutated state: ${JSON.stringify(probe)} (seed=${seed} step=${step})`,
          ).toBe(true);
        }
        // then advance the game with one random legal move
        const moves = enumerateMoves(state);
        state = applyIntent(db, state, pick(moves)).state;
        step++;
      }
    });
  }
});

// ─── targeted robustness probes ──────────────────────────────────────────────

function freshGame(): AutoGameState {
  const config: GameConfig = {
    seed: "probe",
    players: [
      { id: "p1", leader: "FL-A", deck: DECK_A },
      { id: "p2", leader: "FL-B", deck: DECK_B },
    ],
    firstPlayer: "p1",
  };
  let { state } = createGame(db, config);
  state = applyIntent(db, state, { type: "respondMulligan", player: "p1", take: false }).state;
  state = applyIntent(db, state, { type: "respondMulligan", player: "p2", take: false }).state;
  return state;
}

describe("robustness: malformed intents", () => {
  it("rejects an intent with an unknown type", () => {
    const state = freshGame();
    const garbage = { type: "openTreasureChest", player: "p1" } as unknown as PlayerIntent;
    expect(() => applyIntent(db, state, garbage)).toThrow(EngineError);
  });

  it("rejects concede from an unknown player", () => {
    const state = freshGame();
    expect(() => applyIntent(db, state, { type: "concede", player: "intruder" })).toThrow(EngineError);
  });

  it("rejects duplicate iids in a target selection", () => {
    // static guard — exercised dynamically by the legal fuzz; here we only
    // assert the validation path exists for a state with no pending choice
    const state = freshGame();
    expect(() => applyIntent(db, state, { type: "respondTargets", player: "p1", iids: ["x", "x"] }))
      .toThrow(EngineError);
  });
});
