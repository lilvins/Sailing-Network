/**
 * Replacement effects (8-1-3-4, M5): "If [this / your] Character would be
 * K.O.'d / removed from the field (by your opponent's effect), you may [do X]
 * instead."
 *
 * A replacement is a compiled effect with timing "replacement": `replaces`
 * says which removal it answers, `cost` is the "X instead" (it must be
 * payable in full, 8-3-1-3), `actions` are usually empty. Before a removal
 * happens the engine asks the protected card's owner (`mayReplace`); on "yes"
 * the replacement resolves as its own effect and the removal of that card
 * does not happen.
 */
import type { Action } from "../ir/types";
import { canPayCost, conditionsMet, fieldOf, isOnField, matchesFilter } from "./effects";
import type { AutoGameState, CardDb, Iid, PID } from "./state";

/** The removal a replacement can answer. */
export type RemovalEvent = "koBattle" | "koEffect" | "bounce" | "deckBottom" | "life" | "trash" | "rest";

export interface ReplacementOption { sourceOwner: PID; sourceIid: Iid; effectIndex: number }

/** The removal an action would cause to a card on the field (null = none). */
export function removalOf(action: Action): RemovalEvent | null {
  switch (action.kind) {
    case "koTarget": return "koEffect";
    case "returnToHand": return "bounce";
    case "returnToDeck": return "deckBottom";
    case "trashTarget": return "trash";
    case "addToLife": return "life";
    case "restTarget": return "rest"; // M5: "If this Character would be rested by …, you may … instead"
    default: return null;
  }
}

/** Replacements available for card (owner, iid) about to suffer `event`
 *  caused by `cause` (the effect's controller; undefined = battle). Skips the
 *  ones in `declined` ("sourceIid:effectIndex"). */
export function findReplacements(
  db: CardDb, state: AutoGameState, owner: PID, iid: Iid, event: RemovalEvent, cause: PID | undefined, declined: string[],
): ReplacementOption[] {
  if (!isOnField(state, owner, iid)) return [];
  const out: ReplacementOption[] = [];
  // "If any of your Characters would be K.O.'d in battle during this turn, you may … instead" (M5): granted by an Event
  const granted = state.modifiers.filter((m) => m.kind === "restriction" && m.restriction === "grantsReplacement"
    && m.targetOwner === owner && m.targetIid === state.players[owner].leaderIid);
  const sources: [Iid, number | undefined][] = [...fieldOf(state, owner).map((s): [Iid, number | undefined] => [s, undefined]),
    ...granted.map((m): [Iid, number | undefined] => [m.source, m.amount])];
  for (const [src, only] of sources) {
    const inst = state.players[owner].instances[src];
    if (!inst) continue;
    const effects = db(inst.cardId).compiled?.effects ?? [];
    effects.forEach((fx, effectIndex) => {
      if (only !== undefined && effectIndex !== only) return;
      const rep = fx.replaces;
      if (fx.timing !== "replacement" || !rep) return;
      if (declined.includes(`${src}:${effectIndex}`)) return;
      if (!rep.events.includes(event)) return;
      if (rep.byOpponent && (cause === undefined || cause === owner)) return;
      if (rep.subject === "self" && src !== iid) return;
      if (only === undefined && db(inst.cardId).category === "Event") return; // an Event's replacement only works when granted
      if (rep.subject === "ally") {
        if (rep.excludeSelf && src === iid) return;
        if (!state.players[owner].zones.characterArea.includes(iid)) return;
        if (rep.filter && !matchesFilter(db, state, owner, iid, rep.filter, src, true)) return;
      }
      if (!conditionsMet(db, state, owner, src, fx.conditions)) return;
      if (fx.oncePerTurn && state.oncePerTurnUsed[`${owner}:${src}:${effectIndex}`] === state.turn) return;
      if (!canPayCost(db, state, owner, src, fx.cost)) return;
      out.push({ sourceOwner: owner, sourceIid: src, effectIndex });
    });
  }
  return out;
}
