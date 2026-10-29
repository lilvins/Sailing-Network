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
import { conditionsMet, matchesFilter, quantity, resolveSelector } from "./effects";
import { isNegated, type AutoGameState, type CardDb, type Iid, type Modifier, type PID } from "./state";
import { cachedPerVersion } from "./stateVersion";

/** Action kinds a `static` effect can apply continuously today. */
// negateEffect: read by isNegated (state.ts), not stored as a modifier
const CONTINUOUS_KINDS = new Set<Action["kind"]>(["powerMod", "costMod", "grantKeyword", "restriction", "setBasePower", "setCounter", "negateEffect"]);

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

/** "this card in your hand …" (M5): a static whose selector is the card
 *  itself in the hand works from the hand; every other static, from the field. */
const worksFrom = (a: Action, inHand: boolean): boolean =>
  "sel" in a && (!!a.sel.self && a.sel.zone === "hand") === inHand;

function computePass(db: CardDb, state: AutoGameState): Modifier[] {
  const out: Modifier[] = [];
  for (const owner of state.order) {
    const field = new Set(fieldCards(state, owner));
    for (const iid of [...field, ...state.players[owner].zones.hand]) {
      const inst = state.players[owner].instances[iid];
      if (isNegated(state, owner, iid, db)) continue; // M5: "negate the effect"
      const effects = db(inst.cardId).compiled?.effects ?? [];
      for (const fx of effects) {
        if (fx.timing !== "static") continue;
        if (!fx.actions.some((a) => worksFrom(a, !field.has(iid)))) continue;
        if (!conditionsMet(db, state, owner, iid, fx.conditions)) continue;
        for (const a of fx.actions) {
          if (!isContinuousAction(a) || !("sel" in a) || !worksFrom(a, !field.has(iid))) continue;
          // "the base power of … with 4000 base power becomes 8000" selects by the printed value
          const s = a.kind === "setBasePower" && a.sel.filter ? { ...a.sel, filter: { ...a.sel.filter, printedBase: true } } : a.sel;
          // a "this card" selector may carry a filter ("on the turn in which it is played", M5)
          const targets = a.sel.self
            ? (!a.sel.filter || matchesFilter(db, state, owner, iid, a.sel.filter, iid, field.has(iid)) ? [{ owner, iid }] : [])
            : resolveSelector(db, state, owner, iid, s);
          const scaled = (amount: number, scale?: { q: Parameters<typeof quantity>[2]; per: number }) =>
            scale ? amount * Math.floor(quantity(state, owner, scale.q, db) / scale.per) : amount;
          for (const t of targets) {
            const base = {
              source: iid, controller: owner, targetOwner: t.owner, targetIid: t.iid,
              duration: "permanentWhileInPlay" as const, anchor: owner, createdTurn: state.turn,
            };
            switch (a.kind) {
              case "powerMod": out.push({ ...base, kind: "powerMod", amount: scaled(a.amount, a.scale) }); break;
              case "costMod": out.push({ ...base, kind: "costMod", amount: scaled(a.amount, a.scale) }); break;
              case "setBasePower": out.push({ ...base, kind: "basePower",
                amount: a.fromLeaderBase ? db(state.players[owner].instances[state.players[owner].leaderIid].cardId).power ?? 0 : a.amount }); break;
              case "setCounter": out.push({ ...base, kind: "counter", amount: a.amount }); break;
              case "grantKeyword": out.push({ ...base, kind: "keywordGrant", keyword: a.keyword }); break;
              case "restriction": out.push({
                ...base, kind: "restriction", restriction: a.what,
                ...(a.amount !== undefined ? { amount: a.amount } : {}),
                ...(a.attributes ? { attributes: a.attributes } : {}),
                ...(a.attackerCharactersOnly ? { attackerCharactersOnly: true } : {}),
                ...(a.attackerLeadersOnly ? { attackerLeadersOnly: true } : {}),
                ...(a.exceptAttributes ? { exceptAttributes: a.exceptAttributes } : {}),
                ...(a.sourceFilter ? { sourceFilter: a.sourceFilter } : {}),
                ...(a.sourceOpponentOnly ? { sourceOpponentOnly: true } : {}),
              }); break;
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
  return inProgress ?? fixpoint(db, state);
}

/** Every modifier in force: stored (one-shot effects) + continuous. */
export function activeModifiers(db: CardDb, state: AutoGameState): Modifier[] {
  return inProgress ? withStored(state, inProgress) : allModifiers(db, state);
}

const withStored = (state: AutoGameState, statics: Modifier[]) =>
  statics.length ? state.modifiers.concat(statics) : state.modifiers;

// Both are asked hundreds of times per intent (every power, cost, keyword and
// restriction check) but only change when an event changes the state.
const allModifiers = cachedPerVersion((db: CardDb, state: AutoGameState) => withStored(state, fixpoint(db, state)));
const fixpoint = cachedPerVersion((db: CardDb, state: AutoGameState): Modifier[] => {
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
});
