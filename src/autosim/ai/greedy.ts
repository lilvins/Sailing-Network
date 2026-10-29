import type { PlayerIntent } from "../engine/intents";
import { applyIntentInPlace } from "../engine/engine";
import { fitChoice } from "../engine/effects";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, ChoiceRequest, Iid, PID } from "../engine/state";
import { effectivePower, opponentOf } from "../engine/state";
import { seededRng } from "../../lib/rng";
import type { Agent } from "./agent";
import { determinize } from "./determinize";
import { evaluate } from "./evaluate";
import { payDonIntent } from "./random";
import { GREEDY } from "./tuning";

/**
 * The greedy agent: fixed rules where a rule is enough (mulligan, counters,
 * DON!!, attacks) and a one-move lookahead where it is not (which card to
 * play, effect choices, blocks): each option is tried on an imagined copy of
 * the game (determinize — no peeking at hidden cards), the effect or battle is
 * played out with the quick rules, and the option with the best evaluation wins.
 * Port of optcg-ai's src/ai/greedy.ts onto AUTOSIM.
 */
export function createGreedyAgent(seed = "greedy"): Agent {
  const rng = seededRng(seed);
  return {
    name: "Greedy",
    decide: (db, state, pid) => decide(db, state, pid, rng),
  };
}

type Ctx = { db: CardDb; pid: PID; rng: () => number };

function decide(db: CardDb, state: AutoGameState, pid: PID, rng: () => number): PlayerIntent {
  const ctx: Ctx = { db, pid, rng };
  const pc = state.pendingChoice;
  if (!pc) return mainPhase(ctx, state);
  const options = choiceOptions(db, state, pc);
  if (options.length === 1) return options[0];
  return bestByLookahead(ctx, state, options) ?? options[0];
}

/** Quick rules only (no lookahead): how both seats answer inside a lookahead. */
export function quickIntent(db: CardDb, state: AutoGameState, pc: ChoiceRequest): PlayerIntent {
  return choiceOptions(db, state, pc)[0];
}

// ---------------------------------------------------------------------------
// Choices: the first option is the quick rule's answer; the others are the
// alternatives the lookahead compares it with.

export function choiceOptions(db: CardDb, state: AutoGameState, pc: ChoiceRequest): PlayerIntent[] {
  const player = pc.player;
  switch (pc.kind) {
    case "mulligan": return [{ type: "respondMulligan", player, take: !keepHand(db, state, player) }];
    case "blockWindow": {
      const best = bestBlocker(db, state, player, pc.blockers);
      const others = pc.blockers.filter((b) => b !== best).slice(0, GREEDY.maxOptions - 1);
      return [best, null, ...others].filter((b, i, all) => all.indexOf(b) === i)
        .map((blockerIid) => ({ type: "respondBlock", player, blockerIid }));
    }
    case "counterWindow": return [counterIntent(db, state, player)];
    case "triggerDecision": return yesNo((activate) => ({ type: "respondTrigger", player, activate }));
    case "mayActivate": return yesNo((activate) => ({ type: "respondMay", player, activate }));
    case "mayReplace": return yesNo((use) => ({ type: "respondReplace", player, use }));
    case "manualResolve": return [{ type: "ackManual", player }];
    case "payDon": return [payDonIntent(state, player, pc.amount)];
    case "chooseNumber":
      return [...new Set([pc.max, pc.min])].map((value) => ({ type: "respondNumber", player, value }));
    case "chooseOption":
      return pc.enabled.flatMap((ok, index) => (ok ? [{ type: "respondOption" as const, player, index }] : []));
    case "arrangeLife": return [{ type: "respondArrangeLife", player, order: pc.cards.slice(pc.toDeckTop), toDeck: pc.cards.slice(0, pc.toDeckTop) }];
    case "selectTargets": return targetOptions(db, state, pc).map((iids) => ({ type: "respondTargets", player, iids }));
    case "peekSelect": return peekOptions(db, state, pc);
  }
}

const yesNo = (make: (yes: boolean) => PlayerIntent) => [make(true), make(false)];

function keepHand(db: CardDb, state: AutoGameState, pid: PID): boolean {
  const p = state.players[pid];
  const cheap = p.zones.hand.filter((iid) => (db(p.instances[iid].cardId).cost ?? 99) <= GREEDY.cheapCost);
  return cheap.length >= GREEDY.keepCheap;
}

/** Value of a card in play: cost first, power as tie-break. */
export function cardValue(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number {
  const card = db(state.players[owner].instances[iid].cardId);
  const onField = state.players[owner].zones.characterArea.includes(iid) || state.players[owner].leaderIid === iid;
  return (card.cost ?? 0) * 1000 + (onField ? effectivePower(db, state, owner, iid) : card.power ?? 0);
}

/** Block with the cheapest card that survives; chump-block only for the last Life. */
function bestBlocker(db: CardDb, state: AutoGameState, pid: PID, blockers: Iid[]): Iid | null {
  const b = state.battle;
  if (!b) return null;
  const atk = effectivePower(db, state, b.attackerOwner, b.attackerIid);
  const onLeader = b.targetIid === state.players[pid].leaderIid;
  const lastLife = state.players[pid].zones.life.length === 0;
  let best: Iid | null = null;
  let bestScore = -Infinity;
  for (const iid of blockers) {
    const cost = db(state.players[pid].instances[iid].cardId).cost ?? 0;
    const survives = effectivePower(db, state, pid, iid) > atk;
    const score = survives ? 100 - cost : onLeader && lastLife ? 50 - cost : -Infinity;
    if (score > bestScore) { bestScore = score; best = iid; }
  }
  return best;
}

/**
 * Counter only when it matters (Leader at low Life, an expensive Character)
 * and when the cards in hand can actually stop the attack: the smallest card
 * that covers the gap, else the biggest one (the window reopens for the next).
 */
export function counterIntent(db: CardDb, state: AutoGameState, pid: PID): PlayerIntent {
  const pass: PlayerIntent = { type: "passCounter", player: pid };
  const b = state.battle;
  if (!b) return pass;
  const p = state.players[pid];
  const need = effectivePower(db, state, b.attackerOwner, b.attackerIid) - effectivePower(db, state, pid, b.targetIid);
  if (need < 0) return pass;
  const onLeader = b.targetIid === p.leaderIid;
  const targetCost = db(p.instances[b.targetIid].cardId).cost ?? 0;
  const worthIt = onLeader ? p.zones.life.length <= GREEDY.counterLeaderAtLife : targetCost >= GREEDY.counterCharFromCost;
  if (!worthIt) return pass;

  const lm = legalMoves(db, state);
  const cards = lm.counterCards.map((c) => ({ amount: c.amount, intent: { type: "useCounter", player: pid, cardIid: c.iid, targetIid: b.targetIid } as PlayerIntent }));
  if (cards.reduce((s, c) => s + c.amount, 0) <= need) return pass;
  cards.sort((x, y) => x.amount - y.amount);
  return (cards.find((c) => c.amount > need) ?? cards[cards.length - 1]).intent;
}

const HARMFUL = new Set(["koTarget", "restTarget", "returnToHand", "returnToDeck", "trashTarget", "setBasePower", "restriction", "negateEffect", "ungiveDon", "freezeDon", "lifeToHand", "trashLife"]);

/** Candidate answers to a "choose targets" prompt, the quick rule's first. */
function targetOptions(db: CardDb, state: AutoGameState, pc: Extract<ChoiceRequest, { kind: "selectTargets" }>): Iid[][] {
  const me = pc.player;
  const value = (c: { owner: PID; iid: Iid }) => cardValue(db, state, c.owner, c.iid);
  const enemyBestFirst = pc.candidates.filter((c) => c.owner !== me).sort((a, b) => value(b) - value(a));
  const mineBestFirst = pc.candidates.filter((c) => c.owner === me).sort((a, b) => value(b) - value(a));
  const harmful = [...enemyBestFirst, ...[...mineBestFirst].reverse()];
  const helpful = [...mineBestFirst, ...[...enemyBestFirst].reverse()];
  const fit = (list: { iid: Iid }[]) => fitChoice(db, state, pc, list.slice(0, pc.count).map((c) => c.iid));
  const lists = HARMFUL.has(pc.actionKind) ? [fit(harmful), fit(helpful)] : [fit(helpful), fit(harmful)];
  if (pc.count === 1) for (const c of pc.candidates.slice(0, GREEDY.maxOptions)) lists.push([c.iid]);
  if (pc.upTo) lists.push([]);
  const seen = new Set<string>();
  return lists.filter((l) => (pc.upTo || l.length === Math.min(pc.count, pc.candidates.length)) && !seen.has(l.join()) && !!seen.add(l.join()));
}

/** Look at the top of the deck: take the most expensive eligible cards, or one in particular, or none. */
function peekOptions(db: CardDb, state: AutoGameState, pc: Extract<ChoiceRequest, { kind: "peekSelect" }>): PlayerIntent[] {
  const p = state.players[pc.player];
  const cost = (iid: Iid) => db(p.instances[iid].cardId).cost ?? 0;
  const byCost = [...pc.eligible].sort((a, b) => cost(b) - cost(a));
  const takes = [byCost.slice(0, pc.takeCount), ...(pc.takeCount >= 1 ? byCost.slice(1, GREEDY.maxOptions).map((iid) => [iid]) : []), []];
  const seen = new Set<string>();
  return takes.filter((t) => !seen.has(t.join()) && !!seen.add(t.join())).map((take) => {
    const remaining = pc.cards.filter((iid) => !take.includes(iid));
    return {
      type: "respondPeek", player: pc.player, take,
      restTop: pc.rest === "topAnyOrder" || pc.rest === "topOrBottomAnyOrder" ? remaining : [],
      restBottom: pc.rest === "bottomAnyOrder" ? remaining : [],
    };
  });
}

// ---------------------------------------------------------------------------
// Main phase: play cards (best evaluation first), then DON!!, then attacks.

function mainPhase(ctx: Ctx, state: AutoGameState): PlayerIntent {
  const { db } = ctx;
  const lm = legalMoves(db, state);
  const player = lm.actor;
  const p = state.players[player];

  const plays: PlayerIntent[] = [];
  for (const play of lm.playableFromHand) {
    const card = db(p.instances[play.iid].cardId);
    if (!play.needsReplace) plays.push({ type: "playCard", player, iid: play.iid });
    else if (card.category === "Character") {
      const victim = [...p.zones.characterArea].sort((a, b) => cardValue(db, state, player, a) - cardValue(db, state, player, b))[0];
      const victimCost = db(p.instances[victim].cardId).cost ?? 0;
      if ((card.cost ?? 0) > victimCost) plays.push({ type: "playCard", player, iid: play.iid, replaceIid: victim });
    }
  }
  for (const act of lm.activatable) plays.push({ type: "activateMain", player, iid: act.iid, effectIndex: act.effectIndex });

  if (plays.length) {
    const before = evaluate(db, state, player);
    const best = scoreByLookahead({ ...ctx, pid: player }, state, plays).sort((a, b) => b.score - a.score)[0];
    if (best && best.score > before + GREEDY.minGain) return best.intent;
  }

  const don = donIntent(db, state, lm.attackers, player);
  if (don) return don;
  return attackIntent(db, state, lm.attackers, player) ?? { type: "endTurn", player };
}

/**
 * DON!! one at a time, to the attacker that needs the fewest to beat the
 * opposing Leader by 1000 (so a single counter card does not stop it);
 * whatever is left goes on the Leader.
 */
export function donIntent(db: CardDb, state: AutoGameState, attackers: { iid: Iid; targets: Iid[] }[], player: PID): PlayerIntent | null {
  const p = state.players[player];
  const oppLeader = state.players[opponentOf(state, player)].leaderIid;
  const ready = attackers.filter((a) => a.targets.includes(oppLeader)).map((a) => a.iid);
  if (p.don.active <= 0 || !ready.length) return null;
  const goal = effectivePower(db, state, opponentOf(state, player), oppLeader) + 1000;
  let best: { iid: Iid; n: number } | null = null;
  for (const iid of ready) {
    const missing = goal - effectivePower(db, state, player, iid);
    if (missing <= 0) continue;
    const n = Math.ceil(missing / 1000);
    if (n <= p.don.active && (!best || n < best.n)) best = { iid, n };
  }
  const target = best?.iid ?? (ready.includes(p.leaderIid) ? p.leaderIid : ready[0]);
  return { type: "giveDon", player, targetIid: target };
}

/** The Leader if the attack can connect, else the most valuable rested Character we can beat. */
export function attackIntent(db: CardDb, state: AutoGameState, attackers: { iid: Iid; targets: Iid[] }[], player: PID): PlayerIntent | null {
  const opp = opponentOf(state, player);
  const oppLeader = state.players[opp].leaderIid;
  let best: PlayerIntent | null = null;
  let bestScore = 0;
  for (const a of attackers) {
    const ap = effectivePower(db, state, player, a.iid);
    for (const t of a.targets) {
      const tp = effectivePower(db, state, opp, t);
      if (ap < tp) continue;
      const score = t === oppLeader ? 1_000_000 + ap - tp : 500_000 + cardValue(db, state, opp, t);
      if (score > bestScore) { bestScore = score; best = { type: "attack", player, attackerIid: a.iid, targetIid: t }; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Lookahead

function bestByLookahead(ctx: Ctx, state: AutoGameState, options: PlayerIntent[]): PlayerIntent | null {
  const scored = scoreByLookahead(ctx, state, options.slice(0, GREEDY.maxOptions));
  return scored.sort((a, b) => b.score - a.score)[0]?.intent ?? null;
}

/**
 * Every option is tried on the same imagined world (one determinization seed
 * for all, so the comparison is fair), then the effect or battle it opens is
 * played out with the quick rules until no prompt is open (back in a Main Phase).
 * Options the engine refuses are dropped.
 */
function scoreByLookahead(ctx: Ctx, state: AutoGameState, options: PlayerIntent[]): { intent: PlayerIntent; score: number }[] {
  const worldSeed = Math.floor(ctx.rng() * 1e9).toString(36);
  const out: { intent: PlayerIntent; score: number }[] = [];
  for (const intent of options) {
    const world = determinize(state, ctx.pid, seededRng(worldSeed));
    try {
      applyIntentInPlace(ctx.db, world, intent);
      settle(ctx.db, world);
    } catch {
      continue;
    }
    out.push({ intent, score: evaluate(ctx.db, world, ctx.pid) });
  }
  return out;
}

function settle(db: CardDb, world: AutoGameState): void {
  for (let i = 0; i < GREEDY.settleSteps && world.phase !== "over" && world.pendingChoice; i++) {
    applyIntentInPlace(db, world, quickIntent(db, world, world.pendingChoice));
  }
}
