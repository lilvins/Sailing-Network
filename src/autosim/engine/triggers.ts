/**
 * AUTOSIM auto-effect queue (M1) — the "trigger queue" with the resolution
 * ordering of comprehensive rules 8-6:
 *
 *  - effects whose activation timing is fulfilled earlier resolve earlier
 *    (tracked by a fulfillment generation `gen`, 8-6-1-1);
 *  - within the same generation the TURN PLAYER resolves first (8-6-1);
 *  - effects fulfilled while another effect resolves get a later generation,
 *    so a non-turn-player effect already pending resolves before a turn-player
 *    effect fulfilled afterwards (8-6-1 second sentence);
 *  - effects fulfilled during damage processing resolve after all damage
 *    processing (8-6-2) — battle.ts drains the queue only once damage is done.
 *
 * This module is pure queue mechanics (no imports from effects.ts/battle.ts);
 * eligibility (conditions, costs, 8-1-3-1-3) is checked by the pump at
 * resolution time.
 */
import type { Timing } from "../ir/types";
import type { AutoGameState, CardDb, ExecState, FlowResume, Iid, PID, QueuedEffect } from "./state";

/** Get-or-create the exec bookkeeping. `flow` is only applied on creation —
 *  an in-progress resolution keeps its resumption point. */
export function ensureExec(state: AutoGameState, flow: FlowResume): ExecState {
  if (!state.exec) state.exec = { queue: [], gen: 0, running: null, pendingMay: null, flow };
  return state.exec;
}

/** Queue every compiled effect of `iid` with the given timing (its activation
 *  timing was just fulfilled). All effects queued before the next resolution
 *  starts share the current generation (simultaneous fulfillment, 8-6-1). */
export function enqueueAutoEffects(
  db: CardDb, state: AutoGameState, owner: PID, iid: Iid, timing: Timing,
  opts?: { fromTrash?: boolean },
): void {
  const inst = state.players[owner].instances[iid];
  const compiled = db(inst.cardId).compiled;
  if (!compiled) return;
  const exec = ensureExec(state, { at: "none" });
  compiled.effects.forEach((fx, effectIndex) => {
    if (fx.timing !== timing) return;
    exec.queue.push({
      controller: owner, sourceIid: iid, sourceCardId: inst.cardId,
      effectIndex, gen: exec.gen, fromTrash: opts?.fromTrash,
    });
  });
}

/** Pop the next effect to resolve per 8-6-1: lowest generation first; within
 *  a generation the turn player's effects first, in queue (FIFO) order. */
export function takeNext(state: AutoGameState): QueuedEffect | null {
  const exec = state.exec;
  if (!exec || exec.queue.length === 0) return null;
  const minGen = Math.min(...exec.queue.map((q) => q.gen));
  const pickFrom = (pid: PID | null): number =>
    exec.queue.findIndex((q) => q.gen === minGen && (pid === null || q.controller === pid));
  let idx = pickFrom(state.turnPlayer);      // 8-6-1: turn player first
  if (idx === -1) idx = pickFrom(null);      // then the non-turn player
  const [q] = exec.queue.splice(idx, 1);
  return q;
}

/** Bump the fulfillment generation: everything enqueued from now on was
 *  fulfilled LATER than what is already queued (8-6-1-1). Called by the pump
 *  whenever an effect starts resolving. */
export function nextGeneration(state: AutoGameState): void {
  if (state.exec) state.exec.gen += 1;
}
