// Rule-based policy. Used directly as the "casual" AI and, with the playbook and
// smarter DON splitting turned on, as the fast playout policy inside rollouts.

import { abilityOf } from '../engine/runner.js';
import { actor, applyAction, canAttackThisTurn, legalActions } from '../engine/game.js';
import { evaluate } from './evaluate.js';
import { counterValue, playCost, power, readSession } from '../engine/query.js';
import { findCard, opp } from '../engine/state.js';
import { DON_ACTIVE, DON_RESTED, type Action, type Ability, type CardInst, type Db, type GameState, type Seat } from '../engine/types.js';
import { curveCosts, type Playbook } from './playbook.js';

export interface GreedyOptions {
  /** Split DON across attackers to beat the opposing leader instead of stacking the leader. */
  smartDon?: boolean;
  /** Use the playbook curve for card choice. */
  useCurve?: boolean;
  /** Skip the resolve-and-evaluate checks (fast playouts). */
  fast?: boolean;
}

/** Effects that are bad for the card they hit (removal, debuffs, costs). */
const HARMFUL = new Set([
  'KOCard', 'KOIfCostXOrLess', 'TrashCard', 'SendToDeckBottom', 'SendToDeckTop', 'SendToTopLife', 'SendToBottomLife', 'Rest',
  'Freeze', 'Silence', 'SilenceToOwnersEnd', 'CantAttack', 'CantRest', 'SetBasePowerToZero', 'SetPowerToZero', 'LoseBlocker',
  'DetachDon', 'DonMinus', 'OptionalReturnDon', 'TrashSelf', 'InfiniteReturnToDeck',
]);

// ---------------------------------------------------------------------------
// Prompts

export function mulliganDecision(db: Db, s: GameState, seat: Seat, pb: Playbook | null): Action {
  const hand = s.players[seat].hand;
  const costs = hand.map((c) => db[c.id].cost);
  const rule = pb?.mulligan;
  let keep: boolean;
  if (rule) {
    keep = false;
    if (rule.minCheap !== undefined) keep ||= costs.filter((c) => c <= (rule.cheapMaxCost ?? 2)).length >= rule.minCheap;
    if (rule.keepIfAny?.length) keep ||= hand.some((c) => rule.keepIfAny!.includes(c.id));
  } else keep = costs.filter((c) => c <= 3).length >= 2;
  return { type: 'mulligan', redraw: !keep };
}

/** Attack power minus defending power: >= 0 means the attack currently connects. */
export function battleMargin(db: Db, s: GameState): number {
  const b = s.battle;
  if (!b) return -1;
  return power(db, s, b.attacker) - power(db, s, b.target);
}

export function greedyBlock(db: Db, s: GameState, seat: Seat): Action {
  const b = s.battle!;
  const atk = power(db, s, b.attacker);
  const opts = legalActions(db, s).filter((a): a is Extract<Action, { type: 'block' }> => a.type === 'block' && a.blocker !== null);
  const isLeader = s.players[seat].leader.uid === b.target;
  const lifeLeft = s.players[seat].life.length;
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const a of opts) {
    const bp = power(db, s, a.blocker!);
    const cost = db[findCard(s, a.blocker!)!.inst.id].cost;
    let score = -Infinity;
    if (bp > atk) score = 100 - cost;
    else if (isLeader && lifeLeft <= 1) score = 50 - cost;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? { type: 'block', blocker: null };
}

/** Power a [Counter] Event adds (sum of its BuffCombatPower steps). */
export function counterEventValue(db: Db, id: string): number {
  let v = 0;
  for (const ab of db[id].abilities) if (ab.proc.Counter) for (const st of ab.steps) if (st.effect?.BuffCombatPower > 0) v += st.effect!.BuffCombatPower;
  return v;
}

export function cardCounter(db: Db, s: GameState, c: CardInst): { v: number; cost: number } {
  const d = db[c.id];
  if (d.type === 'Character') return { v: counterValue(db, s, c.uid), cost: 0 };
  if (d.type === 'Event') return { v: counterEventValue(db, c.id), cost: playCost(db, s, c.uid) };
  return { v: 0, cost: 0 };
}

/**
 * Pick the counter card to play now, or null if the attack cannot (or need not) be stopped.
 * Prefers the smallest single card that covers the gap; otherwise the biggest card first.
 */
export function counterCard(db: Db, s: GameState, seat: Seat): number | null {
  const need = battleMargin(db, s);
  if (need < 0) return null;
  const legal = new Set(legalActions(db, s).flatMap((a) => (a.type === 'counter' && a.uid !== null ? [a.uid] : [])));
  const p = s.players[seat];
  const cards = p.hand
    .filter((c) => legal.has(c.uid))
    .map((c) => ({ c, ...cardCounter(db, s, c) }))
    .filter((x) => x.v > 0 && x.cost <= p.donActive);
  const total = cards.reduce((sum, x) => sum + x.v, 0);
  if (total <= need) return null;
  cards.sort((a, b) => a.v - b.v || a.cost - b.cost);
  const single = cards.find((x) => x.v > need);
  return (single ?? cards[cards.length - 1]).c.uid;
}

export function greedyCounter(db: Db, s: GameState, seat: Seat): Action {
  const b = s.battle!;
  const p = s.players[seat];
  const need = battleMargin(db, s);
  if (need < 0) return { type: 'counter', uid: null };
  const t = findCard(s, b.target);
  const isLeader = p.leader.uid === b.target;
  const worthIt = isLeader ? p.life.length <= 2 : !!t && db[t.inst.id].cost >= 4 && need < 2000;
  return { type: 'counter', uid: worthIt ? counterCard(db, s, seat) : null };
}

export function cardValue(db: Db, s: GameState, uid: number): number {
  const f = findCard(s, uid);
  if (!f) return 0;
  const d = db[f.inst.id];
  const onField = f.zone === 'chars' || f.zone === 'leader' || f.zone === 'stage';
  return d.cost * 1000 + (onField ? power(db, s, uid) : d.power) + d.counter / 2;
}

/** Effect keys of the step currently waiting for a selection. */
export function pendingStepKeys(db: Db, s: GameState): string[] {
  const act = s.stack[s.stack.length - 1];
  if (!act) return [];
  const ab: Ability | undefined = abilityOf(db, act);
  const st = ab?.steps[act.stepIdx];
  return Object.entries(st?.effect ?? {})
    .filter(([k, v]) => v && !(k === 'BuffPower' && Number(v) > 0))
    .map(([k, v]) => (k === 'BuffPower' && Number(v) < 0 ? 'Debuff' : k));
}

function donOwner(u: number): Seat {
  return u === DON_ACTIVE(0) || u === DON_RESTED(0) ? 0 : 1;
}

/** Heuristic answer to a "choose cards" prompt. */
export function greedySelect(db: Db, s: GameState, seat: Seat): Action {
  const pr = s.prompt;
  if (pr?.kind !== 'select') throw new Error('no select prompt');
  const legal = legalActions(db, s);
  const picks = legal.filter((a): a is Extract<Action, { type: 'pick' }> => a.type === 'pick');
  const canDone = legal.some((a) => a.type === 'done');
  const keys = pendingStepKeys(db, s);
  const harmful = keys.some((k) => HARMFUL.has(k) || k === 'Debuff');
  const owner = (u: number): Seat => (u < 0 ? (u <= -1000 ? findCard(s, -1000 - u)!.owner : donOwner(u)) : findCard(s, u)!.owner);

  const enemy = picks.filter((a) => owner(a.uid) !== seat);
  const mine = picks.filter((a) => owner(a.uid) === seat);
  // Opponent cards: hit the most valuable one.
  if (enemy.length && (harmful || !mine.length)) {
    const best = enemy.sort((x, y) => cardValue(db, s, y.uid) - cardValue(db, s, x.uid))[0];
    return best;
  }
  if (!mine.length) return canDone ? { type: 'done' } : picks[0];
  if (harmful) {
    // Paying a cost / losing something: give as little as possible, the cheapest.
    const mustPick = pr.chosen.length < pr.min;
    const optionalCost = pr.cancelable && pr.min === 0 && pr.chosen.length === 0;
    if (!mustPick && !optionalCost && canDone) return { type: 'done' };
    if (keys.includes('Rest') || keys.includes('DonMinus') || keys.includes('OptionalReturnDon')) {
      const restedFirst = mine.find((a) => a.uid === DON_RESTED(seat)) ?? mine.find((a) => a.uid === DON_ACTIVE(seat));
      if (restedFirst) return restedFirst;
    }
    return mine.sort((x, y) => cardValue(db, s, x.uid) - cardValue(db, s, y.uid))[0];
  }
  // Beneficial: give it to the best target; for DON pick our rested DON to untap.
  const rested = mine.find((a) => a.uid === DON_RESTED(seat));
  if (keys.includes('Activate') && rested) return rested;
  const b = s.battle;
  if (b) {
    const inBattle = mine.find((a) => a.uid === (b.attackerOwner === seat ? b.attacker : b.target));
    if (inBattle) return inBattle;
  }
  const leader = mine.find((a) => a.uid === s.players[seat].leader.uid && !s.players[seat].leader.rested);
  if (leader && (keys.includes('AttachRestedDon') || keys.includes('AttachActiveDon') || keys.includes('BuffPower'))) return leader;
  return mine.sort((x, y) => cardValue(db, s, y.uid) - cardValue(db, s, x.uid))[0];
}

export function declareChoice(db: Db, s: GameState, seat: Seat): Action {
  // most common cost in the opponent's remaining deck (the decklist is public)
  const counts = new Map<number, number>();
  for (const c of s.players[opp(seat)].deck) counts.set(db[c.id].cost, (counts.get(db[c.id].cost) ?? 0) + 1);
  let best = 0;
  let n = -1;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return { type: 'choose', idx: best };
}

// ---------------------------------------------------------------------------
// Main phase

const REMOVAL = new Set(['KOCard', 'KOIfCostXOrLess', 'Rest', 'SendToHand', 'SendToDeckBottom', 'SendToTopLife', 'SendToBottomLife', 'Freeze']);
const VALUE = new Set(['DrawCards', 'StartTopDeck', 'StartTopDeckFromTrash', 'DeployCharacter', 'GainActiveDon', 'GainRestedDon', 'Heal']);

function abilityKeys(ab: Ability): string[] {
  return ab.steps.flatMap((st) => Object.keys(st.effect ?? {}));
}

function hasCostOrLimit(ab: Ability): boolean {
  if (ab.proc.OncePerTurn) return true;
  return ab.steps.some((st) => {
    const e = st.effect ?? {};
    return e.DonTap || e.DonMinus || e.RestSelf || e.TrashSelf || (st.details?.Required && (e.TrashCard || e.SendToDeckBottom));
  });
}

function playScore(db: Db, s: GameState, seat: Seat, a: Action, pb: Playbook | null, useCurve: boolean): number {
  const uid = a.type === 'play' || a.type === 'activate' ? a.uid : -1;
  const c = findCard(s, uid)!.inst;
  const d = db[c.id];
  if (d.type === 'Event') {
    const ab = d.abilities[(a as Extract<Action, { type: 'activate' }>).ability];
    const left = s.players[seat].donActive - playCost(db, s, uid);
    if (ab.steps.some((st) => st.details?.Required && Number(st.details.AvailableDon ?? st.effect?.DonTap ?? 0) > left && st !== ab.steps[0])) return -1;
    const keys = abilityKeys(ab);
    const oppChars = s.players[opp(seat)].chars.length;
    if (keys.some((k) => REMOVAL.has(k)) && oppChars) return d.cost * 2 + 8;
    if (keys.some((k) => VALUE.has(k))) return d.cost * 2 + 2;
    return -1;
  }
  if (d.type === 'Stage') return s.players[seat].stage ? -1 : d.cost + 1;
  let score = d.cost * 2 + 1;
  if (useCurve) {
    const curve = curveCosts(pb, s, seat);
    if (curve.length) score += curve[0] === d.cost ? 60 : curve.includes(d.cost) ? 30 : 0;
  }
  return score;
}

function smartDonAction(db: Db, s: GameState, seat: Seat): Action | null {
  const p = s.players[seat];
  if (p.donActive <= 0 || !canAttackThisTurn(s)) return null;
  const goal = power(db, s, s.players[opp(seat)].leader.uid) + 1000;
  const ready = [p.leader, ...p.chars.filter((c) => c.enteredTurn !== s.turn)].filter((c) => !c.rested);
  if (!ready.length) return null;
  let best: { c: CardInst; n: number } | null = null;
  for (const c of ready) {
    const missing = goal - power(db, s, c.uid);
    if (missing <= 0) continue;
    const n = Math.ceil(missing / 1000);
    if (n <= p.donActive && (!best || n < best.n)) best = { c, n };
  }
  if (best) return { type: 'attachDon', target: best.c.uid, n: best.n };
  const sink = ready.includes(p.leader) ? p.leader : ready[0];
  return { type: 'attachDon', target: sink.uid, n: p.donActive };
}

export function greedyMain(db: Db, s: GameState, seat: Seat, pb: Playbook | null, opts: GreedyOptions = {}): Action {
  const legal = legalActions(db, s);
  const p = s.players[seat];

  const plays: { a: Action; sc: number }[] = [];
  for (const a of legal) {
    const isEvent = a.type === 'activate' && db[findCard(s, a.uid)!.inst.id].type === 'Event';
    if (a.type !== 'play' && !isEvent) continue;
    const sc = playScore(db, s, seat, a, pb, !!opts.useCurve);
    if (sc > 0) plays.push({ a, sc });
  }
  plays.sort((x, y) => y.sc - x.sc);
  for (const { a } of plays) {
    if (a.type !== 'activate') return a;
    if (opts.fast) return a;
    if (lookaheadDepth > 0) continue;
    // Events: only if resolving it actually improves the position.
    lookaheadDepth++;
    try {
      const before = evaluate(db, s, seat, pb);
      let t = applyAction(db, s, a);
      for (let i = 0; i < 60 && t.winner === null && (t.stack.length || t.pending.length || (t.prompt && t.prompt.kind !== 'counter' && t.prompt.kind !== 'block')); i++)
        t = applyAction(db, t, greedyAction(db, t, actor(t), pb), { noClone: true });
      if (evaluate(db, t, seat, pb) > before) return a;
    } catch {
      // not playable after all
    } finally {
      lookaheadDepth--;
    }
  }

  for (const a of legal) {
    if (a.type !== 'activate') continue;
    const f = findCard(s, a.uid)!;
    if (f.zone === 'hand') continue;
    const ab = db[f.inst.id].abilities[a.ability];
    if (!hasCostOrLimit(ab)) continue;
    const keys = abilityKeys(ab);
    if (keys.includes('TrashCard') && p.hand.length <= 2) continue;
    return a;
  }

  if (canAttackThisTurn(s) && p.donActive > 0) {
    const don = opts.smartDon ? smartDonAction(db, s, seat) : !p.leader.rested ? ({ type: 'attachDon', target: p.leader.uid, n: p.donActive } as Action) : null;
    if (don) return don;
  }

  let bestAtk: Action | null = null;
  let atkScore = 0;
  const oppLeader = s.players[opp(seat)].leader.uid;
  for (const a of legal) {
    if (a.type !== 'attack') continue;
    const ap = power(db, s, a.attacker);
    const tp = power(db, s, a.target);
    if (ap < tp) continue;
    const sc = a.target === oppLeader ? 1000 + (ap - tp) : 500 + tp;
    if (sc > atkScore) {
      atkScore = sc;
      bestAtk = a;
    }
  }
  return bestAtk ?? { type: 'endTurn' };
}

let lookaheadDepth = 0;

/**
 * Compare a few answers to an effect prompt by resolving the ability with the
 * greedy policy and evaluating the result (used for choices, confirmations and
 * optional costs, where a fixed rule is often wrong).
 */
export function lookahead(db: Db, s: GameState, seat: Seat, pb: Playbook | null, options: Action[]): Action {
  if (lookaheadDepth > 0 || options.length < 2) return options[0];
  lookaheadDepth++;
  try {
    const depth = s.stack.length;
    let best = options[0];
    let bestV = -Infinity;
    for (const a of options) {
      let t: GameState;
      try {
        t = applyAction(db, s, a);
        for (let i = 0; i < 60 && t.winner === null && (t.stack.length >= depth && t.stack.length > 0 || (t.prompt && t.prompt.kind !== 'counter' && t.prompt.kind !== 'block')); i++) {
          const who = actor(t);
          t = applyAction(db, t, greedyAction(db, t, who, pb), { noClone: true });
        }
      } catch {
        continue;
      }
      const v = evaluate(db, t, seat, pb);
      if (v > bestV) {
        bestV = v;
        best = a;
      }
    }
    return best;
  } finally {
    lookaheadDepth--;
  }
}

export function greedyAction(db: Db, s: GameState, seat: Seat, pb: Playbook | null, opts: GreedyOptions = {}): Action {
  return readSession(s, () => greedyActionRaw(db, s, seat, pb, opts));
}

function greedyActionRaw(db: Db, s: GameState, seat: Seat, pb: Playbook | null, opts: GreedyOptions): Action {
  const pr = s.prompt;
  if (opts.fast && pr && (pr.kind === 'choice' || pr.kind === 'confirm')) return pr.kind === 'choice' ? { type: 'choose', idx: 0 } : { type: 'confirm', yes: true };
  if (pr && (pr.kind === 'choice' || pr.kind === 'confirm' || (pr.kind === 'select' && pr.cancelable && pr.chosen.length === 0))) {
    const options = legalActions(db, s);
    const preferred = pr.kind === 'select' ? greedySelect(db, s, seat) : options[0];
    const rest = options.filter((a) => JSON.stringify(a) !== JSON.stringify(preferred)).filter((a) => a.type !== 'pick' || pr.kind !== 'select');
    return lookahead(db, s, seat, pb, [preferred, ...rest.slice(0, 3)]);
  }
  if (pr) {
    switch (pr.kind) {
      case 'mulligan':
        return mulliganDecision(db, s, seat, opts.useCurve ? pb : null);
      case 'block':
        return greedyBlock(db, s, seat);
      case 'counter':
        return greedyCounter(db, s, seat);
      case 'trigger':
        return { type: 'trigger', use: true };
      case 'select':
        return greedySelect(db, s, seat);
      case 'declare':
        return declareChoice(db, s, seat);
    }
  }
  return greedyMain(db, s, seat, pb, opts);
}
