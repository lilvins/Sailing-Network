import { applyIntent } from "../engine/engine";
import type { PlayerIntent } from "../engine/intents";
import type { AutoGameState, CardDb, PID } from "../engine/state";
import { opponentOf } from "../engine/state";
import { isRemoval } from "./cardTraits";
import { quickIntent } from "./greedy";
import { GREEDY } from "./tuning";

/**
 * A card played into nothing. Checked for real on a copy, with the effect's
 * prompts answered by the quick rules. Such a play is never a candidate:
 * - a removal Character that takes no opponent's Character off the field —
 *   "a Vander Decken cast blind is a 2000 for a card, that is a −1";
 * - an Event whose effect changes nothing but paying for it — "Electrical
 *   Luna with nothing rested" (Vins, 2026-10-30).
 */
export function isWastedPlay(db: CardDb, state: AutoGameState, intent: PlayerIntent): boolean {
  if (intent.type !== "playCard") return false;
  const card = db(state.players[intent.player].instances[intent.iid].cardId);
  const removal = isRemoval(db, card.id);
  if (!removal && card.category !== "Event") return false;
  const after = resolved(db, state, intent);
  if (!after) return false; // the engine decides legality, not this check
  const opp = opponentOf(state, intent.player);
  if (removal) return state.players[opp].zones.characterArea.every((iid) => after.players[opp].zones.characterArea.includes(iid));
  return boardPrint(state, intent.player, true) === boardPrint(after, intent.player, false);
}

/** The state once the play and every prompt it opens are resolved, or null if refused. */
function resolved(db: CardDb, state: AutoGameState, intent: PlayerIntent): AutoGameState | null {
  try {
    let world = applyIntent(db, state, intent).state;
    for (let i = 0; i < GREEDY.settleSteps && world.phase !== "over" && world.pendingChoice; i++) {
      world = applyIntent(db, world, quickIntent(db, world, world.pendingChoice)).state;
    }
    return world;
  } catch {
    return null;
  }
}

/**
 * Everything an Event could change, except what playing it costs (the card
 * leaving the hand, DON!! rested, the trash): both fields, Life, decks, the
 * opponent's hand and DON!!, active modifiers. `before` counts the Event as
 * already gone from the hand.
 */
function boardPrint(state: AutoGameState, me: PID, before: boolean): string {
  const sides = Object.values(state.players).map((p) => ({
    field: [...p.zones.characterArea, ...p.zones.stage, p.leaderIid].map((iid) => `${iid}:${p.instances[iid].rested ? 1 : 0}:${p.don.given[iid] ?? 0}`),
    life: p.zones.life.length,
    deck: p.zones.deck.length,
    hand: p.zones.hand.length - (before && p.id === me ? 1 : 0),
    don: p.id === me ? null : [p.don.active, p.don.rested],
  }));
  return JSON.stringify({ sides, modifiers: state.modifiers.length, over: state.phase === "over" });
}
