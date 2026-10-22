/**
 * AUTOSIM effect executor core (M1 — AUTOSIM_PLAN.md §5, §8 M1.5).
 *
 * Pure helpers that turn IR `Action`s into GameEvents: selector resolution,
 * filter matching, condition evaluation (8-3-2), activation-cost payment
 * (8-3-1) and the tier-1 action implementations. The flow machine that decides
 * WHEN an effect runs (queue ordering 8-6, battle resumption) lives in
 * battle.ts — this module never imports it.
 *
 * Tier-1 actions (plan §8 M1): powerMod, draw, koTarget, restTarget,
 * standTarget, discard, grantKeyword, restriction. Everything else degrades
 * to a `manualResolve` prompt (plan §1.3) — plus the [Trigger]-only
 * `playFromZone self` ("play this card").
 */
import type { Action, Condition, CostItem, Selector, SelectorFilter } from "../ir/types";
import { emit, type GameEvent } from "./events";
import {
  effectivePower, hasRestriction, keywordsOf, opponentOf,
  type AutoGameState, type CardDb, type Iid, type PID, type RunningEffect,
} from "./state";
import { enqueueAutoEffects } from "./triggers";

export interface TargetRef { owner: PID; iid: Iid }

// ─── drawing (4-5) ───────────────────────────────────────────────────────────

export function drawCards(state: AutoGameState, log: GameEvent[], player: PID, count: number): void {
  const p = state.players[player];
  for (let i = 0; i < count; i++) {
    // defensive: an empty deck can't normally be reached (the game ends the
    // moment it empties, below) but a draw against it is still a defeat
    if (p.zones.deck.length === 0) {
      emit(state, log, { type: "gameEnded", winner: opponentOf(state, player), reason: "deckOut" });
      return;
    }
    emit(state, log, { type: "cardsDrawn", player, iids: [p.zones.deck[0]] });
    // 1-2-1-1-2 + 9-1-2: 0 cards in deck is a defeat condition and rule
    // processing resolves IMMEDIATELY — drawing your last card loses on the
    // spot, not on the next draw attempt.
    if (p.zones.deck.length === 0) {
      emit(state, log, { type: "gameEnded", winner: opponentOf(state, player), reason: "deckOut" });
      return;
    }
  }
}

// ─── filters & selectors (plan §5 Selector) ──────────────────────────────────

/** Whether a card instance matches a selector filter. `onField` controls
 *  whether power is the effective (modified) value (8-1-3-3 recalc) or base. */
export function matchesFilter(
  db: CardDb, state: AutoGameState, owner: PID, iid: Iid,
  filter: SelectorFilter | undefined, sourceIid: Iid, onField: boolean,
): boolean {
  if (!filter) return true;
  const inst = state.players[owner].instances[iid];
  const card = db(inst.cardId);
  if (filter.excludeSelf && iid === sourceIid) return false;
  if (filter.category && !filter.category.includes(card.category)) return false;
  if (filter.typeIncludes && !filter.typeIncludes.some((t) => card.types.includes(t))) return false;
  if (filter.colors && !filter.colors.some((c) => card.colors.includes(c))) return false;
  // 2-1-2: name matching needs the card name; a missing name never matches
  if (filter.nameIncludes) {
    const name = (card.name ?? "").toLowerCase();
    if (!filter.nameIncludes.some((n) => name.includes(n.toLowerCase()))) return false;
  }
  const cost = card.cost ?? 0;
  if (filter.costAtMost !== undefined && cost > filter.costAtMost) return false;
  if (filter.costAtLeast !== undefined && cost < filter.costAtLeast) return false;
  const power = onField ? effectivePower(db, state, owner, iid) : (card.power ?? 0);
  if (filter.powerAtMost !== undefined && power > filter.powerAtMost) return false;
  if (filter.powerAtLeast !== undefined && power < filter.powerAtLeast) return false;
  if (filter.rested !== undefined && inst.rested !== filter.rested) return false;
  if (filter.hasKeyword && !keywordsOf(db, state, owner, iid).has(filter.hasKeyword)) return false;
  return true;
}

const FIELD_ZONES = new Set(["characterArea", "leader", "leaderOrCharacter", "stage"]);

/** All instances a selector can designate right now (legal target set). */
export function resolveSelector(
  db: CardDb, state: AutoGameState, controller: PID, sourceIid: Iid, sel: Selector,
): TargetRef[] {
  const owners: PID[] =
    sel.owner === "self" ? [controller]
    : sel.owner === "opponent" ? [opponentOf(state, controller)]
    : [...state.order];
  const onField = FIELD_ZONES.has(sel.zone);
  const out: TargetRef[] = [];
  for (const owner of owners) {
    const p = state.players[owner];
    let pool: Iid[];
    switch (sel.zone) {
      case "characterArea": pool = [...p.zones.characterArea]; break;
      case "leader": pool = [p.leaderIid]; break;
      case "leaderOrCharacter": pool = [p.leaderIid, ...p.zones.characterArea]; break;
      case "stage": pool = [...p.zones.stage]; break;
      case "hand": pool = [...p.zones.hand]; break;
      case "trash": pool = [...p.zones.trash]; break;
      default: pool = []; // deckTop / costArea / life selectors land in M2+
    }
    for (const iid of pool) {
      if (matchesFilter(db, state, owner, iid, sel.filter, sourceIid, onField)) out.push({ owner, iid });
    }
  }
  return out;
}

// ─── conditions (8-3-2) ──────────────────────────────────────────────────────

function whoToPids(state: AutoGameState, controller: PID, who: "self" | "opponent" | "both"): PID[] {
  if (who === "self") return [controller];
  if (who === "opponent") return [opponentOf(state, controller)];
  return [...state.order];
}

/** All conditions of an effect must hold at activation time (8-3-2-1). */
export function conditionsMet(
  db: CardDb, state: AutoGameState, controller: PID, sourceIid: Iid, conditions: Condition[] | undefined,
): boolean {
  if (!conditions) return true;
  return conditions.every((c) => {
    switch (c.kind) {
      case "donAttached": // [DON!! xX] (10-2-9, 8-3-2-3)
        return (state.players[controller].don.given[sourceIid] ?? 0) >= c.count;
      case "yourTurn": return state.turnPlayer === controller;        // 10-2-11
      case "opponentsTurn": return state.turnPlayer !== controller;   // 10-2-12
      case "leaderIs": {
        const p = state.players[controller];
        return matchesFilter(db, state, controller, p.leaderIid, c.filter, sourceIid, true);
      }
      case "countInZone": {
        const n = resolveSelector(db, state, controller, sourceIid, c.sel).length;
        if (c.atLeast !== undefined && n < c.atLeast) return false;
        if (c.atMost !== undefined && n > c.atMost) return false;
        return true;
      }
      case "lifeAtMost": return whoToPids(state, controller, c.who).every((pid) => state.players[pid].zones.life.length <= c.count);
      case "lifeAtLeast": return whoToPids(state, controller, c.who).every((pid) => state.players[pid].zones.life.length >= c.count);
      case "handAtMost": return whoToPids(state, controller, c.who).every((pid) => state.players[pid].zones.hand.length <= c.count);
      case "handAtLeast": return whoToPids(state, controller, c.who).every((pid) => state.players[pid].zones.hand.length >= c.count);
    }
  });
}

// ─── activation costs (8-3-1) ────────────────────────────────────────────────

/** M1 pays restDon (① 8-3-1-5), returnDonToDeck (DON!!−X 8-3-1-6, from the
 *  active cost area only) and restSelf. Costs that need a card choice
 *  (trashFromHand/…) land in M2 — effects carrying them are not offered. */
export function canPayCost(state: AutoGameState, player: PID, sourceIid: Iid, cost: CostItem[] | undefined): boolean {
  if (!cost || cost.length === 0) return true;
  let restNeeded = 0;
  let returnNeeded = 0;
  for (const c of cost) {
    if (c.kind === "restDon") restNeeded += c.count;
    else if (c.kind === "returnDonToDeck") returnNeeded += c.count;
    else if (c.kind === "restSelf") {
      const inst = state.players[player].instances[sourceIid];
      if (!inst || inst.rested) return false;
    } else return false; // trashFromHand / trashSelf / trashFromLife → M2
  }
  return state.players[player].don.active >= restNeeded + returnNeeded;
}

export function payCost(state: AutoGameState, log: GameEvent[], player: PID, sourceIid: Iid, cost: CostItem[] | undefined): void {
  if (!cost || cost.length === 0) return;
  let restDon = 0;
  let returnDon = 0;
  for (const c of cost) {
    if (c.kind === "restDon") restDon += c.count;
    else if (c.kind === "returnDonToDeck") returnDon += c.count;
    else if (c.kind === "restSelf") emit(state, log, { type: "cardRested", player, iid: sourceIid });
  }
  if (restDon > 0 || returnDon > 0) emit(state, log, { type: "costPaid", player, restDon, returnDon });
}

// ─── action planning & application ───────────────────────────────────────────

/** What the pump should do with the next action of a running effect. */
export type ActionPlan =
  | { kind: "apply"; targets: TargetRef[] }
  | { kind: "choose"; chooser: PID; candidates: TargetRef[]; count: number; upTo: boolean }
  | { kind: "manual"; text: string };

const SELECTOR_ACTIONS = new Set<Action["kind"]>([
  "powerMod", "koTarget", "restTarget", "standTarget", "discard", "grantKeyword", "restriction",
]);

/** Resolve the legal target set of a selector-based action and decide whether
 *  a choice is needed (8-4-4). Forced choices auto-resolve: 8-4-4-1 — the
 *  player must choose as many as they can up to the number specified. */
export function planAction(
  db: CardDb, state: AutoGameState, controller: PID, running: RunningEffect, action: Action,
): ActionPlan {
  if (action.kind === "draw") return { kind: "apply", targets: [] };

  if (action.kind === "playFromZone") {
    // [Trigger]-only tier-1 case: "play this card" (sel.self on the trigger card)
    if (action.sel.self && running.triggerCard) return { kind: "apply", targets: [] };
    return { kind: "manual", text: `playFromZone (${action.zone}) is not auto-executable yet — resolve manually` };
  }

  if (action.kind === "manual") return { kind: "manual", text: action.text };

  if (!SELECTOR_ACTIONS.has(action.kind)) {
    return { kind: "manual", text: `unsupported action "${action.kind}" — resolve manually` };
  }

  const act = action as Extract<Action, { sel: Selector }>;
  const sel = act.sel;
  if (sel.self) {
    // the compiled card itself (no choice) — only if still on the field
    const onField = findOnField(state, running.sourceIid);
    return { kind: "apply", targets: onField ? [onField] : [] };
  }
  let candidates = resolveSelector(db, state, controller, running.sourceIid, sel);
  // 10-2-1-2: K.O. moves a CHARACTER from the character area — leaders and
  // non-field cards can never be K.O. targets.
  if (action.kind === "koTarget") {
    candidates = candidates.filter(({ owner, iid }) => state.players[owner].zones.characterArea.includes(iid));
  }
  if (candidates.length === 0) return { kind: "apply", targets: [] };
  if (!sel.upTo && candidates.length <= sel.count) return { kind: "apply", targets: candidates }; // 8-4-4-1
  const chooser = sel.chooser === "opponent" ? opponentOf(state, controller) : controller;
  return { kind: "choose", chooser, candidates, count: sel.count, upTo: sel.upTo ?? false };
}

function findOnField(state: AutoGameState, iid: Iid): TargetRef | null {
  for (const pid of state.order) {
    const p = state.players[pid];
    if (iid === p.leaderIid || p.zones.characterArea.includes(iid) || p.zones.stage.includes(iid)) {
      return { owner: pid, iid };
    }
  }
  return null;
}

/** Apply one action with its resolved targets, emitting events. */
export function applyAction(
  db: CardDb, state: AutoGameState, log: GameEvent[],
  controller: PID, running: RunningEffect, action: Action, targets: TargetRef[],
): void {
  switch (action.kind) {
    case "draw":
      drawCards(state, log, controller, action.count); // may end the game (deck-out)
      break;

    case "powerMod":
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "powerMod",
          targetOwner: t.owner, targetIid: t.iid, amount: action.amount,
          duration: action.duration, anchor: controller, createdTurn: state.turn,
        }});
      }
      break;

    case "grantKeyword":
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "keywordGrant",
          targetOwner: t.owner, targetIid: t.iid, keyword: action.keyword,
          duration: action.duration, anchor: controller, createdTurn: state.turn,
        }});
      }
      break;

    case "restriction":
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "restriction",
          targetOwner: t.owner, targetIid: t.iid, restriction: action.what,
          duration: action.duration, anchor: controller, createdTurn: state.turn,
        }});
      }
      break;

    case "koTarget":
      for (const t of targets) {
        if (!state.players[t.owner].zones.characterArea.includes(t.iid)) continue; // left already
        // M1 enforces no cannotBeKOd (10-2-1-3 — stored, enforced in M4)
        const given = state.players[t.owner].don.given[t.iid] ?? 0;
        // [On K.O.] activates on the field, resolves from the trash
        // (10-2-17-1/2) — fulfilled here, queued per 8-6.
        enqueueAutoEffects(db, state, t.owner, t.iid, "onKO", { fromTrash: true });
        emit(state, log, { type: "characterKOd", player: t.owner, iid: t.iid, donReturned: given });
      }
      break;

    case "restTarget":
      for (const t of targets) {
        if (!state.players[t.owner].instances[t.iid].rested) {
          emit(state, log, { type: "cardRested", player: t.owner, iid: t.iid });
        }
      }
      break;

    case "standTarget":
      for (const t of targets) {
        if (state.players[t.owner].instances[t.iid].rested) {
          emit(state, log, { type: "cardStood", player: t.owner, iid: t.iid });
        }
      }
      break;

    case "discard": // 10-2-14: from hand to trash
      for (const t of targets) {
        emit(state, log, { type: "cardsDiscarded", player: t.owner, iids: [t.iid] });
      }
      break;

    case "playFromZone": {
      // [Trigger] "play this card" (10-1-5-3: the card is area-less right now)
      const tc = running.triggerCard;
      if (!tc || !action.sel.self) break;
      const p = state.players[controller];
      const card = db(p.instances[tc.iid].cardId);
      // 8-1-2 "to the extent possible": a full character area (3-7-6) or a
      // non-Character card can't be played — the card falls to the trash.
      if (card.category === "Character" && p.zones.characterArea.length < 5) {
        emit(state, log, { type: "triggerCardPlayed", player: controller, iid: tc.iid });
        tc.moved = true;
      }
      break;
    }

    default:
      break; // unreachable: planAction routed unsupported kinds to manualResolve
  }
}

/** Convenience used by legality/battle: counter restrictions. */
export function canBlock(db: CardDb, state: AutoGameState, owner: PID, iid: Iid): boolean {
  const inst = state.players[owner].instances[iid];
  if (!inst || inst.rested) return false; // 10-1-4-1: activated by resting
  if (!keywordsOf(db, state, owner, iid).has("Blocker")) return false;
  if (hasRestriction(state, owner, iid, "cannotBlock")) return false;
  return true;
}
