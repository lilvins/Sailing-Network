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
import type { SelectorFilter, Timing } from "../ir/types";
import { hasRestriction, isNegated, type AutoGameState, type CardDb, type ExecState, type FlowResume, type Iid, type PID, type QueuedEffect } from "./state";

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
  opts?: { fromTrash?: boolean; subject?: { owner: PID; iid: Iid } },
): void {
  const inst = state.players[owner].instances[iid];
  const compiled = db(inst.cardId).compiled;
  if (!compiled || isNegated(state, owner, iid, db)) return; // M5: "negate the effect"
  if (timing === "onPlay" && hasRestriction(db, state, owner, state.players[owner].leaderIid, "onPlaysNegated")) return; // M5
  const exec = ensureExec(state, { at: "none" });
  compiled.effects.forEach((fx, effectIndex) => {
    if (fx.timing !== timing) return;
    exec.queue.push({
      controller: owner, sourceIid: iid, sourceCardId: inst.cardId,
      effectIndex, gen: exec.gen, fromTrash: opts?.fromTrash, ...(opts?.subject ? { subject: opts.subject } : {}),
    });
  });
}

/** M5 event timings: queue the effects of `iids` with `timing` whose `react`
 *  filter accepts the event (how many cards; whose effect caused it — `by` is
 *  the controller of the causing effect, undefined when no effect did). */
export function enqueueReactions(
  db: CardDb, state: AutoGameState, owner: PID, iids: Iid[], timing: Timing,
  ctx: { count?: number; by?: PID; subjectOwner?: PID; accept?: (filter: SelectorFilter) => boolean;
    subject?: { owner: PID; iid: Iid }; fromTrash?: boolean;
    /** M5: the card whose effect caused the event matches */
    acceptSource?: (filter: SelectorFilter) => boolean },
  opts?: { fromTrash?: boolean },
): void {
  for (const iid of iids) {
    const inst = state.players[owner].instances[iid];
    const compiled = inst && db(inst.cardId).compiled;
    if (!compiled || isNegated(state, owner, iid, db)) continue;
    const exec = ensureExec(state, { at: "none" });
    compiled.effects.forEach((fx, effectIndex) => {
      if (fx.timing !== timing) return;
      const r = fx.react ?? {};
      if (r.minCount !== undefined && (ctx.count ?? 0) < r.minCount) return;
      if (r.byEffect && ctx.by === undefined) return;
      if (r.by === "you" && ctx.by !== owner) return;
      if (r.by === "opponent" && (ctx.by === undefined || ctx.by === owner)) return;
      if (r.whose === "yours" && ctx.subjectOwner !== owner) return;
      if (r.whose === "opponents" && ctx.subjectOwner === owner) return;
      const srcOk = (f: SelectorFilter) => ctx.acceptSource?.(f) ?? false;
      if (r.filter && !(ctx.accept?.(r.filter) ?? false) && !(r.orSourceFilter && srcOk(r.orSourceFilter))) return;
      if (r.sourceFilter && !srcOk(r.sourceFilter)) return;
      if (r.fromTrash && !ctx.fromTrash) return;
      exec.queue.push({ controller: owner, sourceIid: iid, sourceCardId: inst.cardId, effectIndex, gen: exec.gen, fromTrash: opts?.fromTrash,
        ...(ctx.subject ? { subject: ctx.subject } : {}) });
    });
  }
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
