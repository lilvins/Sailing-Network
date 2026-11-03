import type { PlayerIntent } from "../engine/intents";
import type { AutoGameState, CardDb, Iid, PID } from "../engine/state";
import { effectivePower, opponentOf } from "../engine/state";

/**
 * Turn-order rules on the Main Phase candidates, from the fundamentals
 * audit and the study (TCGMM logs, Fleche, madoka_hk, MetaHub's guides):
 * - a Leader [Activate: Main] that is available comes before any attack
 *   (Mihawk: Characters, then untap 3 DON!!, then attack — strong players
 *   activate before the first attack 66% of the time, the bot 37%);
 * - no End Turn while an attack still connects;
 * - on the opposing Leader the smallest attacker that connects goes first
 *   (second attack stronger 50% vs weaker 16% in the logs).
 * Plays and DON!! stay candidates: the search still decides between them.
 * Never empties the list.
 */
export function orderTurn(db: CardDb, state: AutoGameState, cands: PlayerIntent[]): PlayerIntent[] {
  const me = state.turnPlayer;
  const opp = opponentOf(state, me);
  const oppLeader = state.players[opp].leaderIid;
  const leaderAct = cands.some((c) => c.type === "activateMain" && c.iid === state.players[me].leaderIid);
  let out = leaderAct ? cands.filter((c) => c.type !== "attack") : cands;

  const attacks = out.filter((c): c is Extract<PlayerIntent, { type: "attack" }> => c.type === "attack");
  if (attacks.length) out = out.filter((c) => c.type !== "endTurn");

  const onLeader = attacks.filter((a) => a.targetIid === oppLeader);
  if (onLeader.length > 1) {
    const power = (iid: Iid) => effectivePower(db, state, me as PID, iid);
    const smallest = Math.min(...onLeader.map((a) => power(a.attackerIid)));
    out = out.filter((c) => c.type !== "attack" || c.targetIid !== oppLeader || power(c.attackerIid) === smallest);
  }
  return out.length ? out : cands;
}
