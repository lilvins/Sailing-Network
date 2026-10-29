import type { AutoGameState, AutoPlayerState, CardDb, Iid, PID } from "../engine/state";
import { effectiveCounter, effectivePower, keywordsOf, opponentOf } from "../engine/state";
import { EVAL, SHIELD, WIN, type EvalWeights } from "./tuning";

/**
 * Static evaluation of a position for `pid`: positive = good for pid. The
 * Pro scores the end of every rollout with it, the greedy its lookahead.
 * Each term is a kind of advantage from docs/bot/teoria-del-vantaggio.md:
 * convex Life, hand, counters, board, DON!!, pressure toward lethal; the
 * role (beatdown / control) shifts the weights of Life and hand.
 * `role` is decided once at the decision point (roleOf) and kept for every
 * position the search compares: recomputed per position it flips between
 * sibling moves and makes their values jump (measured: 34% vs 66%).
 */
export function evaluate(db: CardDb, state: AutoGameState, pid: PID, w: EvalWeights = EVAL, role: Role = 0): number {
  if (state.phase === "over") return state.winner === pid ? WIN : -WIN;
  const me = state.players[pid];
  const them = state.players[opponentOf(state, pid)];
  const mine = sideFacts(db, state, me, them);
  const theirs = sideFacts(db, state, them, me);
  const beat = role > 0 ? w.roleShift : 0;
  const ctrl = role < 0 ? w.roleShift : 0;

  let score =
    lifeValue(me.zones.life.length, w.myLifeBase, w.lifeConvex) * (1 - beat) -
    lifeValue(them.zones.life.length, w.oppLifeBase, w.lifeConvex) * (1 + beat) +
    (me.zones.hand.length * w.hand + (mine.counter / 1000) * w.counter) * (1 + ctrl) -
    them.zones.hand.length * w.oppHand - (theirs.counter / 1000) * w.counter +
    (me.zones.characterArea.length - them.zones.characterArea.length) * w.chars +
    (mine.power - theirs.power) / w.powerDivisor +
    (mine.blockers - theirs.blockers) * w.blocker +
    (nextTurnDon(me) - nextTurnDon(them)) * w.don +
    pressureValue(mine.attackers - theirs.shield, w) -
    pressureValue(theirs.attackers - mine.shield, w);

  for (const iid of me.zones.characterArea) {
    const cost = db(me.instances[iid].cardId).cost ?? 0;
    if (me.instances[iid].rested && cost > w.expendableCost) score -= w.rested * cost;
  }
  return score;
}

/** +1 = beatdown (my clock is the faster one), -1 = control, 0 = even. */
export type Role = -1 | 0 | 1;

/** Who's the beatdown here: whoever breaks the other's shield in fewer turns. */
export function roleOf(db: CardDb, state: AutoGameState, pid: PID): Role {
  const me = state.players[pid];
  const them = state.players[opponentOf(state, pid)];
  const mine = sideFacts(db, state, me, them);
  const theirs = sideFacts(db, state, them, me);
  return Math.sign(clock(mine.shield, theirs.attackers) - clock(theirs.shield, mine.attackers)) as Role;
}

type SideFacts = { power: number; blockers: number; counter: number; attackers: number; shield: number };

/** What one side has: board power, active Blockers, counter in hand, next-turn attackers, shield. */
function sideFacts(db: CardDb, state: AutoGameState, p: AutoPlayerState, opp: AutoPlayerState): SideFacts {
  const bar = powerWithoutDon(db, state, opp, opp.leaderIid) - SHIELD.reach;
  let power = 0, blockers = 0, attackers = powerWithoutDon(db, state, p, p.leaderIid) >= bar ? 1 : 0;
  for (const iid of p.zones.characterArea) {
    const pw = powerWithoutDon(db, state, p, iid);
    power += pw;
    if (pw >= bar) attackers++;
    if (!p.instances[iid].rested && keywordsOf(db, state, p.id, iid).has("Blocker")) blockers++;
  }
  const counter = p.zones.hand.reduce((sum, iid) => sum + effectiveCounter(db, state, p.id, iid), 0);
  const shield = p.zones.life.length + blockers + counter / SHIELD.counterPerShield;
  return { power, blockers, counter, attackers, shield };
}

/** Life is convex: the last card is worth base + 4×convex, the 5th and beyond just base. */
function lifeValue(lives: number, base: number, convex: number): number {
  let v = 0;
  for (let i = 1; i <= lives; i++) v += base + convex * Math.max(0, SHIELD.convexLives - i);
  return v;
}

/** Attackers beyond the opponent's shield; past zero lethal is in sight and worth extra. */
function pressureValue(excess: number, w: EvalWeights): number {
  const x = Math.max(-SHIELD.maxPressure, Math.min(SHIELD.maxPressure, excess));
  return x * w.pressure + (x > 0 ? w.lethalBonus : 0);
}

/** Turns one side needs to break the other's shield (fewer = the beatdown). */
function clock(shield: number, attackers: number): number {
  return shield / Math.max(1, attackers);
}

/** DON!! usable next turn: on the field now plus the (up to) 2 of the DON!! phase. */
function nextTurnDon(p: AutoPlayerState): number {
  const given = Object.values(p.don.given).reduce((s, n) => s + n, 0);
  return p.don.active + p.don.rested + given + Math.min(2, p.don.deck);
}

/** Power without the DON!! bonus (that one disappears at the end of the turn). */
function powerWithoutDon(db: CardDb, state: AutoGameState, p: AutoPlayerState, iid: Iid): number {
  const donBonus = p.id === state.turnPlayer ? (p.don.given[iid] ?? 0) * 1000 : 0;
  return effectivePower(db, state, p.id, iid) - donBonus;
}
