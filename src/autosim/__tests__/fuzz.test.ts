import { describe, expect, it } from "vitest";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { EngineError, type PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, EngineCard } from "../engine/state";
import { seededRng } from "../../lib/rng";

/**
 * GAME-SMOOTHNESS fuzz suite (M0).
 *
 * Plays many seeded random games end-to-end by repeatedly asking
 * `legalMoves()` for the options and picking uniformly among them, then
 * checks hard invariants after EVERY applied intent:
 *
 *  - a legal move never throws;
 *  - card conservation per player (deck+hand+trash+life+characterArea+stage
 *    + leader = 51 distinct iids, every iid has an instance record);
 *  - DON!! conservation (deck+active+rested+sum(given) = 10, none negative,
 *    given only to on-board leader/characters);
 *  - cards in piles (deck/hand/trash/life) are never rested;
 *  - the state JSON round-trips (JSON.parse(JSON.stringify(s)) deep-equals s);
 *  - pendingChoice/battle consistency (counter window iff a battle is in its
 *    counter step, mulligan only during setup, nothing pending after game over);
 *  - applyIntent never mutates its input state (purity);
 *  - every game TERMINATES before the intent cap.
 *
 * A second pass fuzzes guaranteed-ILLEGAL intents at every step of a running
 * game: each must throw EngineError and leave the state byte-identical.
 */

// ─── synthetic card DB ───────────────────────────────────────────────────────

// Construction-LEGAL fixtures (5-1-2): ≤4 copies per card number and every
// deck color on the leader (FL-B is Blue/Red multicolor so the all-Red decks
// are legal for both seats). Two card numbers per cost tier keep the cost mix
// while honoring the 4-copy limit.
const CARDS: Record<string, EngineCard> = {
  // leaders (cost = Life value, local DB quirk)
  "FL-A": { id: "FL-A", category: "Leader", cost: 4, power: 5000, counter: null, colors: ["Red"], types: ["Fuzz"] },
  "FL-B": { id: "FL-B", category: "Leader", cost: 5, power: 5000, counter: null, colors: ["Blue", "Red"], types: ["Fuzz"] },
  // events + stages (effects are M2 — plays are still legal moves)
  "FE-1": { id: "FE-1", category: "Event", cost: 1, power: null, counter: null, colors: ["Red"], types: ["Fuzz"] },
  "FS-1": { id: "FS-1", category: "Stage", cost: 1, power: null, counter: null, colors: ["Red"], types: ["Fuzz"] },
};
// characters — two card numbers per cost tier, mix of powers/counters
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
// worst case of two fully passive players racing to deck-out (~80 turns)
const NUM_SEEDS = 32;
const MAX_INTENTS = 700;
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

  // pendingChoice / battle consistency
  const counterPending = state.pendingChoice?.kind === "counterWindow";
  if (state.battle) {
    if (state.battle.step !== "counter") fail(`observable battle in step "${state.battle.step}"`);
    if (!counterPending) fail("battle waiting in counter step but no counterWindow pending");
    if (state.pendingChoice?.kind === "counterWindow" && state.pendingChoice.player !== state.battle.defenderOwner) {
      fail("counter window pending for a player other than the defender");
    }
  }
  if (counterPending && !state.battle) fail("counterWindow pending without a battle");
  if (state.pendingChoice?.kind === "mulligan" && state.phase !== "setup") {
    fail(`mulligan pending during phase "${state.phase}"`);
  }
  if (state.pendingChoice?.kind === "blockWindow") fail("blockWindow surfaced in M0 (no [Blocker] yet)");
  if (state.phase === "over") {
    if (state.pendingChoice) fail("pendingChoice still set after game over");
    if (state.battle) fail("battle still set after game over");
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

// ─── random-move policy ──────────────────────────────────────────────────────

/** Enumerate atomic legal moves from legalMoves() for uniform sampling. */
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
  if (pc?.kind === "counterWindow") {
    // counter-or-pass: counters go to the card actually being attacked
    const target = state.battle!.targetIid;
    const moves: PlayerIntent[] = [{ type: "passCounter", player: actor }];
    for (const c of lm.counterCards) {
      moves.push({ type: "useCounter", player: actor, cardIid: c.iid, targetIid: target });
    }
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
  return moves;
}

interface FuzzResult {
  state: AutoGameState;
  intentCount: number;
  capHit: boolean;
  history: PlayerIntent[];
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
  let { state } = createGame(db, config);
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
    checkInvariants(state, ctx, history.length % 20 === 0);
  }
  checkInvariants(state, ctx, true);

  return { state, intentCount: history.length, capHit: state.phase !== "over", history };
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
      player: pc?.kind === "mulligan" ? (pc.player === first ? second : first) : first,
      take: true,
    },
    // counter-window responses when it is not that player's window
    {
      type: "passCounter",
      player: pc?.kind === "counterWindow" ? (pc.player === first ? second : first) : turnP,
    },
    // countering with a card that is not in hand
    {
      type: "useCounter",
      player: pc?.kind === "counterWindow" ? pc.player : turnP,
      cardIid: ghost,
      targetIid: pc?.kind === "counterWindow" ? state.players[pc.player].leaderIid : p.leaderIid,
    },
    // block responses never apply in M0 (no [Blocker] → no blockWindow)
    { type: "respondBlock", player: turnP, blockerIid: null },
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

      while (state.phase !== "over" && step < 200) {
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
});
