import type { AutoGameState, AutoPlayerState, CardDb, Iid, PID } from "../engine/state";
import { effectiveCounter, effectivePower, keywordsOf, opponentOf } from "../engine/state";
import { counterEventPower, hasLastingEffect, isRemoval } from "./cardTraits";
import { EVAL, SHIELD, WIN, type EvalWeights } from "./tuning";

/**
 * Static evaluation of a position for `pid`: positive = good for pid. The
 * Pro scores the end of every rollout with it, the greedy its lookahead.
 * Each term is a kind of advantage from docs/bot/teoria-del-vantaggio.md:
 * convex Life, hand, counters, useful board (a K.O. worth the cost it kills),
 * removal kept for a big target, DON!!, pressure toward lethal; the
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
    (mine.useful - theirs.useful) * w.chars +
    (mine.fieldCost - theirs.fieldCost) * w.charCost +
    (mine.removals * removalTarget(theirs) - theirs.removals * removalTarget(mine)) * w.removalOption +
    (mine.power - theirs.power) / w.powerDivisor +
    (mine.blockers - theirs.blockers) * w.blocker +
    (nextTurnDon(me) - nextTurnDon(them)) * w.don +
    (curveFill(db, me) - curveFill(db, them)) * w.curve +
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

type SideFacts = {
  power: number; blockers: number; counter: number; attackers: number; shield: number;
  /** Useful Characters (see isUseful), their total and highest cost; removal cards in hand. */
  useful: number; fieldCost: number; maxCost: number; removals: number;
};

/**
 * What one side has: board, active Blockers, counter in hand, next-turn
 * attackers, shield. Only USEFUL Characters count as board: one that reaches
 * the opposing Leader (buffs included), blocks, or has a lasting effect;
 * a Stage counts when it has a lasting effect.
 * A 2000 that does none of these is worth nothing on the field — its On Play,
 * if any, was already cashed in (Vins, 2026-10-30) — and killing it is worth
 * nothing either.
 */
function sideFacts(db: CardDb, state: AutoGameState, p: AutoPlayerState, opp: AutoPlayerState): SideFacts {
  const bar = powerWithoutDon(db, state, opp, opp.leaderIid) - SHIELD.reach;
  let power = 0, blockers = 0, useful = 0, fieldCost = 0, maxCost = 0, attackers = powerWithoutDon(db, state, p, p.leaderIid) >= bar ? 1 : 0;
  for (const iid of p.zones.characterArea) {
    const pw = powerWithoutDon(db, state, p, iid);
    const blocker = keywordsOf(db, state, p.id, iid).has("Blocker");
    if (pw >= bar) attackers++;
    if (blocker && !p.instances[iid].rested) blockers++;
    if (!(pw >= bar || blocker || hasLastingEffect(db, p.instances[iid].cardId))) continue;
    const cost = db(p.instances[iid].cardId).cost ?? 0;
    useful++;
    power += pw;
    fieldCost += cost;
    maxCost = Math.max(maxCost, cost);
  }
  // a Stage with a lasting effect (Coffin Boat: a DON!! back every turn) is a useful permanent too
  for (const iid of p.zones.stage) {
    if (!hasLastingEffect(db, p.instances[iid].cardId)) continue;
    useful++;
    fieldCost += db(p.instances[iid].cardId).cost ?? 0;
  }
  // counter in hand: printed values and [Counter] events alike (Demon Aura +3000 defends too)
  const counter = p.zones.hand.reduce((sum, iid) => sum + effectiveCounter(db, state, p.id, iid) + counterEventPower(db, p.instances[iid].cardId), 0);
  const shield = p.zones.life.length + blockers + counter / SHIELD.counterPerShield;
  const removals = p.zones.hand.filter((iid) => isRemoval(db, p.instances[iid].cardId)).length;
  return { power, blockers, counter, attackers, shield, useful, fieldCost, maxCost, removals };
}

/**
 * What a removal in hand is worth: the best target it still has — the
 * biggest Character on the other side, never less than a future big one.
 * Spending it on a cost-1 Character burns that option (teoria §3.8).
 */
function removalTarget(target: SideFacts): number {
  return Math.max(target.maxCost, SHIELD.futureThreatCost);
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

/**
 * The curve plan (Vins: "a 3 Coffin Boat + Perona, a 5 Oden, a 7 Yasopp"):
 * how much of the next two turns' DON!! the Characters and Stages in hand
 * can spend, 0..2 (1 = a turn fully used). A searcher that finds the missing
 * 5-drop raises it; discarding the piece that filled a turn lowers it.
 */
function curveFill(db: CardDb, p: AutoPlayerState): number {
  const costs = p.zones.hand
    .map((iid) => db(p.instances[iid].cardId))
    .filter((c) => c.category === "Character" || c.category === "Stage")
    .map((c) => c.cost ?? 0)
    .filter((c) => c > 0);
  const d1 = Math.min(SHIELD.maxDon, nextTurnDon(p));
  const d2 = Math.min(SHIELD.maxDon, d1 + 2);
  const first = bestFit(costs, d1);
  const rest = [...costs];
  for (const c of first) rest.splice(rest.indexOf(c), 1);
  const second = bestFit(rest, d2);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return (d1 ? sum(first) / d1 : 0) + (d2 ? sum(second) / d2 : 0);
}

/** The costs that fill `cap` best (subset sum, caps are ≤ 10 so a table over sums is enough). */
function bestFit(costs: number[], cap: number): number[] {
  const best: (number[] | null)[] = Array(cap + 1).fill(null);
  best[0] = [];
  for (const c of costs) {
    for (let s = cap; s >= c; s--) if (!best[s] && best[s - c]) best[s] = [...best[s - c]!, c];
  }
  for (let s = cap; s >= 0; s--) if (best[s]) return best[s]!;
  return [];
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
