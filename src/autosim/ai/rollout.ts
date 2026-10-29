import { applyIntentInPlace } from "../engine/engine";
import type { PlayerIntent } from "../engine/intents";
import { legalMoves } from "../engine/legality";
import type { AutoGameState, CardDb, PID } from "../engine/state";
import { attackIntent, donIntent, quickIntent } from "./greedy";
import { PRO } from "./tuning";

/**
 * The quick policy both seats follow inside a rollout: the greedy rules with
 * no lookahead (a lookahead per move would make every rollout ~50x slower).
 * Main Phase: the most expensive Character or Stage that fits, then DON!!,
 * then attacks, then End Turn. Events and [Activate: Main] are skipped here.
 */
export function fastIntent(db: CardDb, state: AutoGameState): PlayerIntent {
  if (state.pendingChoice) return quickIntent(db, state, state.pendingChoice);
  const lm = legalMoves(db, state);
  const player = lm.actor;
  const p = state.players[player];
  const permanents = lm.playableFromHand
    .filter((c) => !c.needsReplace && db(p.instances[c.iid].cardId).category !== "Event")
    .sort((a, b) => b.cost - a.cost);
  if (permanents.length) return { type: "playCard", player, iid: permanents[0].iid };
  return donIntent(db, state, lm.attackers, player)
    ?? attackIntent(db, state, lm.attackers, player)
    ?? { type: "endTurn", player };
}

/**
 * Plays `world` on (in place) with the quick policy until `horizon` turn
 * changes have happened since the decision. `turnAtDecision` matters: an End
 * Turn candidate has already made one change and must not get an extra turn
 * compared with the other candidates. A move the engine refuses ends the rollout.
 */
export function rollout(db: CardDb, world: AutoGameState, horizon: number, turnAtDecision: PID): void {
  let changes = 0;
  let last = turnAtDecision;
  for (let step = 0; step < PRO.maxRolloutSteps && world.phase !== "over"; step++) {
    if (world.turnPlayer !== last) {
      last = world.turnPlayer;
      if (++changes >= horizon) return;
    }
    try {
      applyIntentInPlace(db, world, fastIntent(db, world));
    } catch {
      return;
    }
  }
}
