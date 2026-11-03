import { applyIntentInPlace } from "../engine/engine";
import type { PlayerIntent } from "../engine/intents";
import { legalMoves, type LegalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, ChoiceRequest, Iid, PID } from "../engine/state";
import { effectivePower, opponentOf } from "../engine/state";
import { seededRng } from "../../lib/rng";
import type { Agent } from "./agent";
import { determinize } from "./determinize";
import { evaluate, roleOf, type Role } from "./evaluate";
import { cardValue, choiceOptions, createGreedyAgent } from "./greedy";
import { rollout } from "./rollout";
import { isWastedPlay } from "./waste";
import { orderTurn } from "./turnOrder";
import { EVAL, PRIOR, PRO, WIN, type EvalWeights } from "./tuning";

export type ProConfig = {
  candidates: number;
  rollouts: number;
  horizon: number;
  /** Evaluation weights (default: tuning's EVAL, i.e. base + learned). */
  weights: EvalWeights;
  /** Safety cap on the moves of one rollout (raise it with a long horizon, e.g. to the end of the game). */
  rolloutSteps: number;
  /** Turn-order rules on the Main Phase candidates (turnOrder.ts). */
  turnOrder: boolean;
};

/**
 * The Pro agent: Monte Carlo search over the current decision.
 * 1. Main Phase: every sensible move, ranked by a quick prior; the best
 *    `candidates`, End Turn and the greedy's own pick go to the search.
 * 2. Each sample: determinize (no peeking), apply the candidate, play on with
 *    the quick policy for `horizon` turn changes, evaluate.
 * 3. Successive halving: every candidate gets a few samples, the better half
 *    gets more, and so on. All candidates share the same imagined worlds
 *    (common random numbers), so they are compared on equal luck.
 * A card played into nothing is never a candidate (waste.ts).
 * Blocks, counters and yes/no prompts are searched the same way; the other
 * prompts (targets, peek, numbers…) go to the greedy lookahead, which is
 * cheap and already good at them. Port of optcg-ai's src/ai/pro.ts.
 */
/** One candidate of the last decision: its mean rollout value and how many rollouts it got. */
export type Thought = { intent: PlayerIntent; mean: number; rollouts: number };

/** The Pro also tells why: the candidates of its last searched decision, best first. */
export interface ProAgent extends Agent {
  lastThoughts(): Thought[];
}

export function createProAgent(seed = "pro", config: Partial<ProConfig> = {}): ProAgent {
  const cfg: ProConfig = { candidates: PRO.candidates, rollouts: PRO.rollouts, horizon: PRO.horizon, weights: EVAL, rolloutSteps: PRO.maxRolloutSteps, turnOrder: false, ...config };
  const rng = seededRng(seed);
  const greedy = createGreedyAgent(`${seed}:greedy`);
  let thoughts: Thought[] = [];
  return {
    name: "Pro",
    decide(db, state, pid) {
      const pc = state.pendingChoice;
      const options = pc ? searchedOptions(db, state, pc) : mainCandidates(db, state, cfg.candidates);
      const greedyPick = greedy.decide(db, state, pid);
      thoughts = [];
      if (!options) return greedyPick;
      let cands = withIntent(options, greedyPick).filter((o) => !isWastedPlay(db, state, o));
      if (cfg.turnOrder && !pc) cands = orderTurn(db, state, cands);
      thoughts = search({ db, pid, rng, cfg, role: roleOf(db, state, pid) }, state, cands.length ? cands : options);
      return thoughts[0].intent;
    },
    lastThoughts: () => thoughts,
  };
}

type Ctx = { db: CardDb; pid: PID; rng: () => number; cfg: ProConfig; role: Role };

// ---------------------------------------------------------------------------
// Candidates

/**
 * The greedy's own answer always competes: the search can only replace it
 * with a move its rollouts find better, never lose it to a low prior.
 */
function withIntent(options: PlayerIntent[], intent: PlayerIntent): PlayerIntent[] {
  const key = JSON.stringify(intent);
  return options.some((o) => JSON.stringify(o) === key) ? options : [intent, ...options];
}

/** Prompts the Pro searches; null = leave it to the greedy lookahead. */
function searchedOptions(db: CardDb, state: AutoGameState, pc: ChoiceRequest): PlayerIntent[] | null {
  switch (pc.kind) {
    case "blockWindow": return choiceOptions(db, state, pc).slice(0, PRO.blockOptions + 2);
    case "counterWindow": return counterOptions(db, state, pc.player);
    case "triggerDecision":
    case "mayActivate":
    case "mayReplace": return choiceOptions(db, state, pc);
    default: return null;
  }
}

/** Take the hit, or stop it with the smallest card that covers the gap (else the biggest). */
function counterOptions(db: CardDb, state: AutoGameState, pid: PID): PlayerIntent[] {
  const pass: PlayerIntent = { type: "passCounter", player: pid };
  const b = state.battle;
  if (!b) return [pass];
  const need = effectivePower(db, state, b.attackerOwner, b.attackerIid) - effectivePower(db, state, pid, b.targetIid);
  const cards = [...legalMoves(db, state).counterCards].sort((x, y) => x.amount - y.amount);
  if (need < 0 || !cards.length) return [pass];
  const card = cards.find((c) => c.amount > need) ?? cards[cards.length - 1];
  return [pass, { type: "useCounter", player: pid, cardIid: card.iid, targetIid: b.targetIid }];
}

/** Main Phase moves worth searching, best prior first, then every activation, End Turn always last. */
function mainCandidates(db: CardDb, state: AutoGameState, keep: number): PlayerIntent[] {
  const lm = legalMoves(db, state);
  const ranked = mainMoves(db, state, lm)
    .map((intent) => ({ intent, prior: prior(db, state, lm.actor, intent) }))
    .sort((a, b) => b.prior - a.prior)
    .slice(0, keep)
    .map((m) => m.intent);
  // [Activate: Main] (Mihawk untapping 3 DON!!) is rare and decisive: never cut by the prior
  const activations: PlayerIntent[] = lm.activatable
    .map((a): PlayerIntent => ({ type: "activateMain", player: lm.actor, iid: a.iid, effectIndex: a.effectIndex }))
    .filter((a) => !ranked.some((r) => JSON.stringify(r) === JSON.stringify(a)));
  return [...ranked, ...activations, { type: "endTurn", player: lm.actor }];
}

function mainMoves(db: CardDb, state: AutoGameState, lm: LegalMoves): PlayerIntent[] {
  const player = lm.actor;
  const p = state.players[player];
  const opp = opponentOf(state, player);
  const moves: PlayerIntent[] = [];
  for (const play of lm.playableFromHand) {
    if (!play.needsReplace) { moves.push({ type: "playCard", player, iid: play.iid }); continue; }
    const victim = [...p.zones.characterArea].sort((a, b) => cardValue(db, state, player, a) - cardValue(db, state, player, b))[0];
    if (victim && play.cost > (db(p.instances[victim].cardId).cost ?? 0)) moves.push({ type: "playCard", player, iid: play.iid, replaceIid: victim });
  }
  for (const act of lm.activatable) moves.push({ type: "activateMain", player, iid: act.iid, effectIndex: act.effectIndex });
  // DON!! only on a card that can still attack: on a rested one it is wasted.
  if (p.don.active > 0) for (const a of lm.attackers) if (lm.canGiveDonTo.includes(a.iid)) moves.push({ type: "giveDon", player, targetIid: a.iid });
  for (const a of lm.attackers) {
    const ap = effectivePower(db, state, player, a.iid);
    for (const t of a.targets) if (ap >= effectivePower(db, state, opp, t)) moves.push({ type: "attack", player, attackerIid: a.iid, targetIid: t });
  }
  return moves;
}

function prior(db: CardDb, state: AutoGameState, pid: PID, intent: PlayerIntent): number {
  switch (intent.type) {
    case "playCard": return PRIOR.play + PRIOR.playPerCost * (db(state.players[pid].instances[intent.iid].cardId).cost ?? 0);
    case "attack": return attackPrior(db, state, pid, intent.attackerIid, intent.targetIid);
    case "giveDon": return PRIOR.giveDon;
    case "activateMain": return PRIOR.activate;
    default: return PRIOR.endTurn;
  }
}

function attackPrior(db: CardDb, state: AutoGameState, pid: PID, attacker: Iid, target: Iid): number {
  const opp = opponentOf(state, pid);
  const them = state.players[opp];
  const margin = effectivePower(db, state, pid, attacker) - effectivePower(db, state, opp, target);
  const face = target === them.leaderIid;
  const bonus = face ? PRIOR.attackFace : PRIOR.attackChar + PRIOR.attackCharPerCost * (db(them.instances[target].cardId).cost ?? 0);
  const v = PRIOR.attack + margin / PRIOR.marginDivisor + bonus;
  const weakFace = face && them.zones.life.length > 1 && margin < PRIOR.weakFaceMargin && them.zones.hand.length > 0;
  return weakFace ? v * PRIOR.weakFaceFactor : v;
}

// ---------------------------------------------------------------------------
// Search

/**
 * Successive halving over `cands` with common random numbers. Returns every
 * candidate with its mean value, best first (the winner = the last survivor).
 */
function search(ctx: Ctx, state: AutoGameState, cands: PlayerIntent[]): Thought[] {
  if (cands.length === 1) return [{ intent: cands[0], mean: 0, rollouts: 0 }];
  const total = ctx.cfg.rollouts * cands.length;
  const rounds = Math.max(1, Math.ceil(Math.log2(cands.length)));
  const worlds = Array.from({ length: Math.max(ctx.cfg.rollouts * 2, 4) }, () => Math.floor(ctx.rng() * 1e9).toString(36));
  const all = cands.map((intent) => ({ intent, sum: 0, n: 0, round: 0 }));
  let alive = all;
  for (let r = 0; r < rounds && alive.length > 1; r++) {
    const per = Math.max(1, Math.floor(total / (alive.length * rounds)));
    for (const c of alive) {
      for (let k = 0; k < per; k++) c.sum += sample(ctx, state, c.intent, worlds[(c.n + k) % worlds.length]);
      c.n += per;
      c.round = r;
    }
    alive.sort((x, y) => y.sum / y.n - x.sum / x.n);
    alive = alive.slice(0, Math.ceil(alive.length / 2));
  }
  // survivors of later rounds first, then by mean
  return [...all]
    .sort((x, y) => (alive.includes(y) ? 1 : 0) - (alive.includes(x) ? 1 : 0) || y.round - x.round || y.sum / y.n - x.sum / x.n)
    .map((c) => ({ intent: c.intent, mean: c.n ? c.sum / c.n : 0, rollouts: c.n }));
}

/** One imagined future of `intent`: its value for the agent. A refused move scores as a loss. */
function sample(ctx: Ctx, state: AutoGameState, intent: PlayerIntent, worldSeed: string): number {
  const world = determinize(state, ctx.pid, seededRng(worldSeed));
  try {
    applyIntentInPlace(ctx.db, world, intent);
  } catch {
    return -WIN;
  }
  rollout(ctx.db, world, ctx.cfg.horizon, state.turnPlayer, ctx.cfg.rolloutSteps);
  return evaluate(ctx.db, world, ctx.pid, ctx.cfg.weights, ctx.role);
}
