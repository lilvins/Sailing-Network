import type { PID } from "./state";

/** What a player does on their own initiative in their turn. Everything else
 *  (targets, "may", costs, peeks…) only answers one of these. */
const OWN_ACTIONS = new Set(["playCard", "attack", "activateMain", "giveDon", "endTurn"]);

/** Where a take-back returns to: the index of the first move it removes, so a
 *  player gets back to before the whole action, not one of its steps. With no
 *  action of theirs since the last turn change (they were answering the
 *  opponent) it removes their latest run of answers. -1 = nothing to take back. */
export function takeBackStart(moves: readonly { player: PID; type?: string }[], by: PID): number {
  let last = moves.length - 1;
  while (last >= 0 && moves[last].player !== by) last--;
  if (last < 0) return -1;
  for (let i = last; i >= 0; i--) {
    const m = moves[i];
    // a turn already ended can only be taken back while it is the very last move
    if (i !== last && m.type === "endTurn") break;
    if (m.player === by && OWN_ACTIONS.has(m.type ?? "")) return i;
  }
  let start = last;
  while (start > 0 && moves[start - 1].player === by && !OWN_ACTIONS.has(moves[start - 1].type ?? "")) start--;
  return start;
}
