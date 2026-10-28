/**
 * Continuous ("permanent") effects — M4 (8-1-3-3).
 *
 * `static` effects of cards on the field are never stored as modifiers: they
 * are recomputed on every query from the current state, so they start and stop
 * exactly when their card and their conditions do (8-1-3-3-1/2) and nothing has
 * to expire. Because a condition or a selector filter can read a value that
 * another continuous effect changes (e.g. "if you have a Character with 7000
 * power or more" vs a "+1000" aura), the set is iterated to a fixpoint
 * (8-1-3-3-5): each pass sees the stored modifiers plus the previous pass.
 */

import type { Action, Effect } from "../ir/types";
import { conditionsMet, resolveSelector } from "./effects";
import type { AutoGameState, CardDb, Iid, Modifier, PID } from "./state";

/** Action kinds a `static` effect can apply continuously today. */
const CONTINUOUS_KINDS = new Set<Action["kind"]>(["powerMod", "costMod", "grantKeyword", "restriction"]);

/** Whether the engine applies this static action continuously. */
export function isContinuousAction(a: Action): boolean {
  return CONTINUOUS_KINDS.has(a.kind) && "duration" in a && a.duration === "permanentWhileInPlay";
}

/** Whether every action of a `static` effect runs automatically (board-auto transparency). */
export function isAutomaticStatic(fx: Effect): boolean {
  return fx.timing === "static" && fx.actions.length > 0 && fx.actions.every(isContinuousAction);
}

const MAX_PASSES = 6;
/** While a pass is computing, queries see these instead of recomputing (no recursion). */
let inProgress: Modifier[] | null = null;

function fieldCards(state: AutoGameState, pid: PID): Iid[] {
  const p = state.players[pid];
  return [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage];
}

function computePass(db: CardDb, state: AutoGameState): Modifier[] {
  const out: Modifier[] = [];
  for (const owner of state.order) {
    for (const iid of fieldCards(state, owner)) {
      const inst = state.players[owner].instances[iid];
      const effects = db(inst.cardId).compiled?.effects ?? [];
      for (const fx of effects) {
        if (fx.timing !== "static") continue;
        if (!conditionsMet(db, state, owner, iid, fx.conditions)) continue;
        for (const a of fx.actions) {
          if (!isContinuousAction(a) || !("sel" in a)) continue;
          const targets = a.sel.self ? [{ owner, iid }] : resolveSelector(db, state, owner, iid, a.sel);
          for (const t of targets) {
            const base = {
              source: iid, controller: owner, targetOwner: t.owner, targetIid: t.iid,
              duration: "permanentWhileInPlay" as const, anchor: owner, createdTurn: state.turn,
            };
            switch (a.kind) {
              case "powerMod": out.push({ ...base, kind: "powerMod", amount: a.amount }); break;
              case "costMod": out.push({ ...base, kind: "costMod", amount: a.amount }); break;
              case "grantKeyword": out.push({ ...base, kind: "keywordGrant", keyword: a.keyword }); break;
              case "restriction": out.push({ ...base, kind: "restriction", restriction: a.what }); break;
            }
          }
        }
      }
    }
  }
  return out;
}

const key = (m: Modifier) => `${m.source}|${m.kind}|${m.targetOwner}|${m.targetIid}|${m.amount ?? ""}|${m.keyword ?? ""}|${m.restriction ?? ""}`;

function same(a: Modifier[], b: Modifier[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
}

/** Modifiers produced right now by the `static` effects on the field. */
export function staticModifiers(db: CardDb, state: AutoGameState): Modifier[] {
  if (inProgress) return inProgress;
  let current: Modifier[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    inProgress = current;
    let next: Modifier[];
    try {
      next = computePass(db, state);
    } finally {
      inProgress = null;
    }
    if (same(next, current)) return next;
    current = next;
  }
  return current; // no fixpoint (oscillating effects): last pass wins
}

/** Every modifier in force: stored (one-shot effects) + continuous. */
export function activeModifiers(db: CardDb, state: AutoGameState): Modifier[] {
  const statics = staticModifiers(db, state);
  return statics.length ? state.modifiers.concat(statics) : state.modifiers;
}
