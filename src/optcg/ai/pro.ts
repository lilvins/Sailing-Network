// "Pro" AI: Monte Carlo search over the current decision.
//
//   1. list legal actions, drop obviously bad ones (attacks that cannot connect)
//   2. rank them with a cheap prior and keep the best `candidates` (+ endTurn)
//   3. evaluate candidates with rollouts: determinize hidden cards, apply the
//      action, play `turns` turn changes with the greedy policy for both sides,
//      evaluate the final position
//        - 'flat':    every candidate gets `rollouts` samples
//        - 'halving': successive halving — all candidates get a few samples, the
//                     better half gets more, and so on, for the same total budget
//   4. pick the candidate with the best mean score
//
// The same determinization seeds are reused for every candidate (common random
// numbers) so candidates are compared on identical guesses of the hidden cards.
// Block and counter decisions are either searched too ('search') or decided by a
// style-dependent probabilistic rule ('rule').

import { applyAction, actor, findCard, legalActions, opp, power } from '../engine/game.js';
import { Rng } from '../engine/rng.js';
import type { Action, Db, GameState, Seat } from '../engine/types.js';
import { determinize } from './determinize.js';
import { DEFAULT_EVAL, evaluate, type EvalOptions, WIN } from './evaluate.js';
import { battleMargin, cardCounter, counterCard, declareChoice, greedyAction, greedyBlock, mulliganDecision } from './greedy.js';
import { curveCosts, type Playbook, type PlaybookSet, playbookFor, type Style, styleOf } from './playbook.js';

export interface SearchBudget {
  candidates: number;
  rollouts: number;
  /** Number of turn changes to simulate after the candidate action. */
  turns: number;
}

export interface ProConfig extends SearchBudget {
  search: 'flat' | 'halving';
  /** Block / counter decisions: searched with rollouts, or a probabilistic rule. */
  defense: 'search' | 'rule';
  eval: EvalOptions;
}

/** Search budget of the original flat Monte Carlo. */
export const DEFAULT_BUDGET: SearchBudget = { candidates: 4, rollouts: 6, turns: 2 };

/** Configuration of the first released Pro (kept for A/B comparisons as "v1"). */
export const PRO_V1: ProConfig = { ...DEFAULT_BUDGET, search: 'flat', defense: 'rule', eval: { donWeight: 0 } };

/** Current default. */
export const PRO_DEFAULT: ProConfig = { candidates: 6, rollouts: 8, turns: 3, search: 'halving', defense: 'search', eval: DEFAULT_EVAL };

/** How likely we defend (block / counter) the leader, by style and remaining life. */
const DEFEND_CHANCE: Record<Style, { high: number; mid: number; low: number }> = {
  flood: { high: 0.15, mid: 0.4, low: 0.85 },
  race: { high: 0.15, mid: 0.45, low: 0.85 },
  balanced: { high: 0.25, mid: 0.55, low: 0.9 },
  conserve: { high: 0.35, mid: 0.65, low: 0.95 },
  starve: { high: 0.35, mid: 0.65, low: 0.95 },
};

/** Tempo / face preference used by the attack prior. */
const ATTACK_BIAS: Record<Style, { face: number; tempo: number }> = {
  flood: { face: 0.85, tempo: 1 },
  race: { face: 0.9, tempo: 1 },
  balanced: { face: 0.7, tempo: 0.8 },
  conserve: { face: 0.6, tempo: 0.7 },
  starve: { face: 0.25, tempo: 0.7 },
};

const MAX_ROLLOUT_STEPS = 800;

export class ProAgent {
  readonly name = 'pro';
  readonly config: ProConfig;
  private rng: Rng;

  constructor(
    private db: Db,
    private books: PlaybookSet,
    seed: number,
    config: Partial<ProConfig> = {},
  ) {
    this.config = { ...PRO_DEFAULT, ...config, eval: { ...PRO_DEFAULT.eval, ...(config.eval ?? {}) } };
    this.rng = new Rng(seed);
  }

  decide(s: GameState, seat: Seat): Action {
    const db = this.db;
    const pb = playbookFor(this.books, s, seat);
    const pr = s.prompt;
    if (pr?.kind === 'mulligan') return mulliganDecision(db, s, seat, pb);
    if (pr?.kind === 'declare') return declareChoice(db, s, seat);
    if (pr?.kind === 'block') return this.config.defense === 'search' ? this.searchBlock(s, seat) : this.block(s, seat, pb);
    if (pr?.kind === 'counter') return this.config.defense === 'search' ? this.searchCounter(s, seat) : this.counter(s, seat, pb);

    let actions = legalActions(db, s);
    if (actions.length <= 1) return actions[0];
    if (!pr) {
      const viable = actions.filter((a) => a.type !== 'attack' || power(db, s, a.attacker) >= power(db, s, a.target));
      if (viable.length) actions = viable;
    }
    const ranked = actions.map((a) => ({ a, prior: this.prior(s, seat, a, pb) })).sort((x, y) => y.prior - x.prior);
    const cands = ranked.slice(0, this.config.candidates).map((x) => x.a);
    const end = actions.find((a) => a.type === 'endTurn');
    if (end && !cands.includes(end)) cands.push(end);
    return this.search(s, seat, cands);
  }

  private seeds(n: number): number[] {
    return Array.from({ length: n }, () => (this.rng.next() * 0xffffffff) >>> 0);
  }

  /** One rollout value of candidate `a` on determinization `seed`. */
  private sample(s: GameState, seat: Seat, a: Action, seed: number): number {
    const t = structuredClone(s);
    determinize(t, seat, new Rng(seed));
    try {
      applyAction(this.db, t, a, { noClone: true });
    } catch {
      return -WIN;
    }
    return this.rollout(t, seat, s.active);
  }

  /** Best candidate by mean rollout value. */
  search(s: GameState, seat: Seat, cands: Action[]): Action {
    if (cands.length === 1) return cands[0];
    const total = this.config.rollouts * Math.min(cands.length, this.config.candidates + 1);
    if (this.config.search === 'flat') {
      const seeds = this.seeds(this.config.rollouts);
      let best = cands[0];
      let bestValue = -Infinity;
      for (const a of cands) {
        const v = seeds.reduce((sum, seed) => sum + this.sample(s, seat, a, seed), 0) / seeds.length;
        if (v > bestValue) [best, bestValue] = [a, v];
      }
      return best;
    }
    // Successive halving with common random numbers.
    const rounds = Math.max(1, Math.ceil(Math.log2(cands.length)));
    const seeds = this.seeds(Math.max(this.config.rollouts * 2, 4));
    let alive = cands.map((a) => ({ a, sum: 0, n: 0 }));
    for (let r = 0; r < rounds && alive.length > 1; r++) {
      const per = Math.max(1, Math.floor(total / (alive.length * rounds)));
      for (const c of alive) {
        for (let k = 0; k < per; k++) {
          const seed = seeds[(c.n + k) % seeds.length];
          c.sum += this.sample(s, seat, c.a, seed);
        }
        c.n += per;
      }
      alive.sort((x, y) => y.sum / y.n - x.sum / x.n);
      alive = alive.slice(0, Math.ceil(alive.length / 2));
    }
    return alive[0].a;
  }

  /**
   * Play on until `turns` turn changes have happened since the decision point.
   * `activeAtDecision` matters: an endTurn candidate has already made one change,
   * and must not be granted an extra turn of its own compared to other candidates.
   */
  private rollout(s: GameState, seat: Seat, activeAtDecision: Seat): number {
    let turnChanges = 0;
    let lastActive = activeAtDecision;
    for (let step = 0; step < MAX_ROLLOUT_STEPS && s.winner === null; step++) {
      if (s.active !== lastActive) {
        lastActive = s.active;
        if (++turnChanges >= this.config.turns) break;
      }
      const who = actor(s);
      const a = greedyAction(this.db, s, who, playbookFor(this.books, s, who), { smartDon: true, useCurve: true, fast: true });
      try {
        applyAction(this.db, s, a, { noClone: true });
      } catch {
        break;
      }
    }
    return evaluate(this.db, s, seat, playbookFor(this.books, s, seat), this.config.eval);
  }

  /** Cheap ordering heuristic so the search spends its budget on plausible moves. */
  prior(s: GameState, seat: Seat, a: Action, pb: Playbook | null): number {
    const db = this.db;
    switch (a.type) {
      case 'play': {
        const d = db[findCard(s, a.uid)!.inst.id];
        const curve = curveCosts(pb, s, seat);
        const curveBonus = curve.length ? (curve[0] === d.cost ? 40 : curve.includes(d.cost) ? 20 : -6) : 0;
        return 45 + d.cost * 5 + curveBonus;
      }
      case 'attack': {
        const ap = power(db, s, a.attacker);
        const tp = power(db, s, a.target);
        const them = s.players[opp(seat)];
        const face = a.target === them.leader.uid;
        const { face: bias, tempo } = ATTACK_BIAS[styleOf(pb)];
        let v = 35 * (0.5 + tempo) + (face ? bias * 30 : (1 - bias) * 30 + db[findCard(s, a.target)!.inst.id].cost * 3) + (ap - tp) / 500;
        // A face attack that a single counter stops is weak unless they are nearly dead.
        if (face && them.life.length > 1 && ap - tp < 2000 && them.hand.length > 0) v *= 0.6;
        return v;
      }
      case 'attachDon':
        return 28 + a.n;
      case 'activate':
        return 24;
      case 'endTurn':
        return 4;
      case 'pick':
      case 'choose':
      case 'trigger':
      case 'confirm':
        return 10;
      case 'done':
        return 8;
      case 'cancel':
        return 2;
      default:
        return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Defense by search: compare "take it" with the best way to stop it.

  private searchBlock(s: GameState, seat: Seat): Action {
    const opts = legalActions(this.db, s).filter((a) => a.type === 'block') as Extract<Action, { type: 'block' }>[];
    if (opts.length <= 1) return opts[0] ?? { type: 'block', blocker: null };
    const greedy = greedyBlock(this.db, s, seat);
    const cheapest = opts
      .filter((a) => a.blocker !== null)
      .sort((x, y) => this.db[findCard(s, x.blocker!)!.inst.id].cost - this.db[findCard(s, y.blocker!)!.inst.id].cost)[0];
    const cands: Action[] = [{ type: 'block', blocker: null }];
    for (const a of [greedy, cheapest]) if (a && !cands.some((c) => JSON.stringify(c) === JSON.stringify(a))) cands.push(a);
    return this.search(s, seat, cands);
  }

  private searchCounter(s: GameState, seat: Seat): Action {
    const need = battleMargin(this.db, s);
    if (need < 0) return { type: 'counter', uid: null };
    const uid = counterCard(this.db, s, seat);
    if (uid === null) return { type: 'counter', uid: null };
    // Leader at 0 life: always stop it.
    const b = s.battle!;
    if (s.players[seat].leader.uid === b.target && s.players[seat].life.length === 0) return { type: 'counter', uid };
    // Once we started countering this battle, finish the job instead of wasting cards.
    const started = findCard(s, b.target)?.inst.mods.some((x) => x.kind === 'power' && x.until.at === 'battle' && x.value > 0) ?? false;
    if (started) return { type: 'counter', uid };
    return this.search(s, seat, [{ type: 'counter', uid: null }, { type: 'counter', uid }]);
  }

  // ---------------------------------------------------------------------------
  // Defense by rule (v1)

  private defendChance(s: GameState, seat: Seat, pb: Playbook | null, leaderTargeted: boolean): number {
    const life = s.players[seat].life.length;
    const t = DEFEND_CHANCE[styleOf(pb)];
    let p = life >= 3 ? t.high : life === 2 ? t.mid : t.low;
    if (!leaderTargeted) p = Math.min(p, 0.4);
    if (pb?.lifeFloor !== undefined && life <= pb.lifeFloor) p = Math.max(p, 0.8);
    return p;
  }

  private block(s: GameState, seat: Seat, pb: Playbook | null): Action {
    const b = s.battle!;
    const choice = greedyBlock(this.db, s, seat);
    const leaderTargeted = s.players[seat].leader.uid === b.target;
    if (choice.type === 'block' && choice.blocker !== null) {
      // Free block (the blocker survives) is always taken.
      if (power(this.db, s, choice.blocker) > power(this.db, s, b.attacker)) return choice;
    }
    const lethal = leaderTargeted && s.players[seat].life.length === 0 && battleMargin(this.db, s) >= 0;
    const chump = legalActions(this.db, s).filter((a) => a.type === 'block' && a.blocker !== null) as Extract<Action, { type: 'block' }>[];
    if (chump.length && leaderTargeted && (lethal || this.rng.next() < this.defendChance(s, seat, pb, true) * 0.8)) {
      const expendable = pb?.expendableCost ?? 1;
      const cheapest = chump
        .map((a) => ({ a, cost: this.db[findCard(s, a.blocker!)!.inst.id].cost }))
        .sort((x, y) => x.cost - y.cost)[0];
      if (lethal || cheapest.cost <= expendable + 1) return cheapest.a;
    }
    return { type: 'block', blocker: null };
  }

  private counter(s: GameState, seat: Seat, pb: Playbook | null): Action {
    const db = this.db;
    const b = s.battle!;
    const me = s.players[seat];
    const need = battleMargin(db, s);
    if (need < 0) return { type: 'counter', uid: null };
    const leaderTargeted = me.leader.uid === b.target;
    const lethal = leaderTargeted && me.life.length === 0;
    const started = findCard(s, b.target)?.inst.mods.some((x) => x.kind === 'power' && x.until.at === 'battle' && x.value > 0) ?? false;
    let defend = lethal || started;
    if (!defend) {
      if (leaderTargeted) defend = this.rng.next() < this.defendChance(s, seat, pb, true);
      else {
        const t = findCard(s, b.target)!.inst;
        const valuable = db[t.id].cost > (pb?.expendableCost ?? 1) && need < 2000;
        defend = valuable && this.rng.next() < this.defendChance(s, seat, pb, false) + 0.2;
      }
    }
    if (!defend) return { type: 'counter', uid: null };
    // Do not spend more than ~3 cards' worth on a non-lethal hit.
    const available = me.hand.reduce((sum, c) => sum + cardCounter(db, s, c).v, 0);
    if (!lethal && need >= 3000 && available < need + 2000) return { type: 'counter', uid: null };
    return { type: 'counter', uid: counterCard(db, s, seat) };
  }
}

export class CasualAgent {
  readonly name = 'casual';
  constructor(
    private db: Db,
    private books: PlaybookSet = {},
  ) {}

  decide(s: GameState, seat: Seat): Action {
    return greedyAction(this.db, s, seat, playbookFor(this.books, s, seat), { smartDon: false, useCurve: false });
  }
}

export interface Agent {
  readonly name: string;
  decide(s: GameState, seat: Seat): Action;
}
