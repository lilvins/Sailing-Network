import type { PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import { fitChoice } from "../engine/effects";
import type { AutoGameState, CardDb, PID } from "../engine/state";

/**
 * A seeded random player: given the state, picks one legal intent uniformly
 * (or with a fixed bias where "always yes" would make games degenerate).
 * Used by the benchmark and the fingerprint test to drive full games; it
 * knows nothing about strategy. Every ChoiceRequest kind is answered.
 */
export type Rng = () => number;

const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];

export function randomIntent(db: CardDb, state: AutoGameState, rng: Rng): PlayerIntent {
  return state.pendingChoice ? answerChoice(db, state, rng) : mainPhaseIntent(db, state, rng);
}

function answerChoice(db: CardDb, state: AutoGameState, rng: Rng): PlayerIntent {
  const pc = state.pendingChoice!;
  const player = pc.player;
  switch (pc.kind) {
    case "mulligan": return { type: "respondMulligan", player, take: rng() < 0.3 };
    case "blockWindow":
      return { type: "respondBlock", player, blockerIid: pc.blockers.length && rng() < 0.5 ? pick(rng, pc.blockers) : null };
    case "counterWindow": return counterIntent(db, state, rng);
    case "triggerDecision": return { type: "respondTrigger", player, activate: rng() < 0.5 };
    case "selectTargets": {
      const n = Math.min(pc.count, pc.candidates.length);
      const take = pc.upTo ? Math.floor(rng() * (n + 1)) : n;
      return { type: "respondTargets", player, iids: fitChoice(db, state, pc, pc.candidates.slice(0, take).map((c) => c.iid)) };
    }
    case "mayActivate": return { type: "respondMay", player, activate: rng() < 0.7 };
    case "manualResolve": return { type: "ackManual", player };
    case "peekSelect": {
      const take = rng() < 0.8 ? pc.eligible.slice(0, pc.takeCount) : [];
      const remaining = pc.cards.filter((iid) => !take.includes(iid));
      return {
        type: "respondPeek", player, take,
        restTop: pc.rest === "topAnyOrder" || pc.rest === "topOrBottomAnyOrder" ? remaining : [],
        restBottom: pc.rest === "bottomAnyOrder" ? remaining : [],
      };
    }
    case "payDon": return payDonIntent(state, player, pc.amount);
    case "chooseNumber": return { type: "respondNumber", player, value: pc.min + Math.floor(rng() * (pc.max - pc.min + 1)) };
    case "chooseOption": {
      const enabled = pc.enabled.flatMap((ok, index) => (ok ? [index] : []));
      return { type: "respondOption", player, index: pick(rng, enabled) };
    }
    case "arrangeLife": {
      const order = [...pc.cards];
      if (rng() < 0.5) order.reverse();
      return { type: "respondArrangeLife", player, order: order.slice(pc.toDeckTop), toDeck: order.slice(0, pc.toDeckTop) };
    }
    case "mayReplace": return { type: "respondReplace", player, use: rng() < 0.5 };
  }
}

function counterIntent(db: CardDb, state: AutoGameState, rng: Rng): PlayerIntent {
  const player = state.pendingChoice!.player;
  const lm = legalMoves(db, state);
  const moves: PlayerIntent[] = [{ type: "passCounter", player }];
  if (state.battle) {
    for (const c of lm.counterCards) moves.push({ type: "useCounter", player, cardIid: c.iid, targetIid: state.battle.targetIid });
  }
  for (const e of lm.counterEvents) moves.push({ type: "useCounterEvent", player, cardIid: e.iid });
  return pick(rng, moves);
}

/** Pays from rested DON!! first, then active, then given (the cheapest order for the payer). */
export function payDonIntent(state: AutoGameState, player: PID, amount: number): PlayerIntent {
  const don = state.players[player].don;
  let left = amount;
  const fromRested = Math.min(left, don.rested); left -= fromRested;
  const fromActive = Math.min(left, don.active); left -= fromActive;
  const fromGiven: Record<string, number> = {};
  for (const [iid, n] of Object.entries(don.given)) {
    if (left <= 0) break;
    const use = Math.min(left, n);
    if (use > 0) { fromGiven[iid] = use; left -= use; }
  }
  return { type: "respondPayDon", player, fromActive, fromRested, fromGiven };
}

function mainPhaseIntent(db: CardDb, state: AutoGameState, rng: Rng): PlayerIntent {
  const lm = legalMoves(db, state);
  const player = lm.actor;
  const p = state.players[player];
  const moves: PlayerIntent[] = [{ type: "endTurn", player }];
  for (const play of lm.playableFromHand) {
    // a full Character area needs a victim; a Stage replaces the current one by itself
    const isCharacter = db(p.instances[play.iid].cardId).category === "Character";
    if (!play.needsReplace || !isCharacter) moves.push({ type: "playCard", player, iid: play.iid });
    else if (p.zones.characterArea.length) {
      moves.push({ type: "playCard", player, iid: play.iid, replaceIid: pick(rng, p.zones.characterArea) });
    }
  }
  for (const target of lm.canGiveDonTo) moves.push({ type: "giveDon", player, targetIid: target });
  for (const a of lm.attackers) for (const target of a.targets) moves.push({ type: "attack", player, attackerIid: a.iid, targetIid: target });
  for (const act of lm.activatable) moves.push({ type: "activateMain", player, iid: act.iid, effectIndex: act.effectIndex });
  return pick(rng, moves);
}
