/**
 * AUTOSIM effect executor core (M1 tier-1, M3 tier-2 — AUTOSIM_PLAN.md §5).
 *
 * Pure helpers that turn IR `Action`s into GameEvents: selector resolution,
 * filter matching, condition evaluation (8-3-2), activation-cost checks
 * (8-3-1) and the action implementations. The flow machine that decides WHEN
 * an effect runs (queue ordering 8-6, battle resumption, cost payment with
 * choices) lives in battle.ts — this module never imports it.
 *
 * Still out of scope (degrade to `manualResolve`, plan §1.3): setBasePower,
 * negateEffect, redirectAttack, endBattle, addToLife, chooseOne, and
 * playFromZone "revealed". `static` effects are continuous (8-1-3-3) and are
 * executed by the M4 fixpoint, not here.
 */
import type { Action, Condition, CostItem, Selector, SelectorFilter } from "../ir/types";
import { emit, type GameEvent } from "./events";
import {
  effectivePower, hasRestriction, keywordsOf, opponentOf,
  type AutoGameState, type CardDb, type Iid, type PID, type RunningEffect,
} from "./state";
import { enqueueAutoEffects } from "./triggers";

export interface TargetRef { owner: PID; iid: Iid }

// ─── drawing (4-5) & milling ─────────────────────────────────────────────────

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

/** Deck top → trash. Milling the last card is a defeat too (9-2-1-2). */
export function millCards(state: AutoGameState, log: GameEvent[], player: PID, count: number): void {
  const p = state.players[player];
  const iids = p.zones.deck.slice(0, count);
  if (iids.length === 0) return;
  emit(state, log, { type: "milled", player, iids });
  if (p.zones.deck.length === 0) {
    emit(state, log, { type: "gameEnded", winner: opponentOf(state, player), reason: "deckOut" });
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
  // "other than [Name]" (M2): a missing name never excludes
  if (filter.nameExcludes) {
    const name = (card.name ?? "").toLowerCase();
    if (filter.nameExcludes.some((n) => name.includes(n.toLowerCase()))) return false;
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
      default: pool = []; // deckTop / costArea / life selectors land in M4+
    }
    for (const iid of pool) {
      if (matchesFilter(db, state, owner, iid, sel.filter, sourceIid, onField)) out.push({ owner, iid });
    }
  }
  return out;
}

export function isOnField(state: AutoGameState, owner: PID, iid: Iid): boolean {
  const p = state.players[owner];
  return iid === p.leaderIid || p.zones.characterArea.includes(iid) || p.zones.stage.includes(iid);
}

function findOnField(state: AutoGameState, iid: Iid): TargetRef | null {
  for (const pid of state.order) {
    if (isOnField(state, pid, iid)) return { owner: pid, iid };
  }
  return null;
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
      case "donOnField": // "N or more DON!! on your field" = cost area + given (4-4)
        return whoToPids(state, controller, c.who).every((pid) => {
          const d = state.players[pid].don;
          const given = Object.values(d.given).reduce((s, n) => s + n, 0);
          return d.active + d.rested + given >= c.atLeast;
        });
      case "selfRested": { // "if this Character is rested" (M3)
        const on = findOnField(state, sourceIid);
        return !!on && state.players[on.owner].instances[sourceIid].rested;
      }
    }
  });
}

// ─── activation costs (8-3-1) — payable check ────────────────────────────────

/** Whether the FULL activation cost can be paid right now (8-3-1-3). Payment
 *  itself happens item by item in the pump (choices may pause it). */
export function canPayCost(
  db: CardDb, state: AutoGameState, player: PID, sourceIid: Iid, cost: CostItem[] | undefined,
): boolean {
  if (!cost || cost.length === 0) return true;
  const p = state.players[player];
  let restDonNeed = 0;
  let returnDonNeed = 0;
  let lifeNeed = 0;
  let handNeed = 0;
  for (const c of cost) {
    switch (c.kind) {
      case "restDon": restDonNeed += c.count; break;
      case "returnDonToDeck": returnDonNeed += c.count; break; // 8-3-1-6
      case "restSelf": {
        const on = findOnField(state, sourceIid);
        if (!on || state.players[on.owner].instances[sourceIid].rested) return false;
        break;
      }
      case "trashSelf":
        if (!findOnField(state, sourceIid)) return false;
        break;
      case "trashFromHand":
        if (resolveSelector(db, state, player, sourceIid, c.sel).length < c.sel.count) return false;
        break;
      case "returnToHand":
      case "restFromField":
        if (resolveSelector(db, state, player, sourceIid, c.sel).length < c.sel.count) return false;
        break;
      case "trashFromLife":
      case "lifeToHand":
        lifeNeed += c.count;
        break;
      case "handToDeckBottom":
        handNeed += c.count;
        break;
    }
  }
  if (p.zones.life.length < lifeNeed) return false;
  if (p.zones.hand.length < handNeed) return false;
  if (p.don.active < restDonNeed) return false;
  const givenSum = Object.values(p.don.given).reduce((s, n) => s + n, 0);
  // DON!!−X may come from the cost area AND from leader/characters (8-3-1-6)
  if (p.don.active - restDonNeed + p.don.rested + givenSum < returnDonNeed) return false;
  return true;
}

// ─── action planning & application ───────────────────────────────────────────

/** What the pump should do with the next action of a running effect. */
export type ActionPlan =
  | { kind: "apply"; targets: TargetRef[] }
  | { kind: "choose"; chooser: PID; candidates: TargetRef[]; count: number; upTo: boolean }
  | { kind: "peek" }                       // handled by the pump (peekSelect window)
  | { kind: "chooseNumber"; max: number }  // "draw up to N"
  | { kind: "manual"; text: string };

const SELECTOR_ACTIONS = new Set<Action["kind"]>([
  "powerMod", "koTarget", "restTarget", "standTarget", "discard", "grantKeyword",
  "restriction", "costMod",
  // tier-2 (M3)
  "returnToHand", "returnToDeck", "playFromZone", "addFromTrashToHand", "giveRestedDon",
]);
const NO_TARGET_ACTIONS = new Set<Action["kind"]>([
  "draw", "mill", "trashLife", "lifeToHand", "placeDonInCostArea", "standDon",
  "returnDonToDeck", "ifThen",
]);

/** Resolve the legal target set of a selector-based action and decide whether
 *  a choice is needed (8-4-4). Forced choices auto-resolve: 8-4-4-1 — the
 *  player must choose as many as they can up to the number specified. */
export function planAction(
  db: CardDb, state: AutoGameState, controller: PID, running: RunningEffect, action: Action,
): ActionPlan {
  if (action.kind === "draw") {
    // "draw up to N": the player picks how many (8-4-4-1 allows 0)
    if (action.upTo && action.count > 0) return { kind: "chooseNumber", max: action.count };
    return { kind: "apply", targets: [] };
  }
  if (NO_TARGET_ACTIONS.has(action.kind)) return { kind: "apply", targets: [] };

  if (action.kind === "peekDeck") {
    if (action.who !== "self") return { kind: "manual", text: "peeking the opponent's deck is not auto-executable yet — resolve manually" };
    return { kind: "peek" };
  }

  if (action.kind === "manual") return { kind: "manual", text: action.text };

  if (action.kind === "playFromZone" && action.zone === "revealed") {
    return { kind: "manual", text: "playFromZone (revealed) is not auto-executable yet — resolve manually" };
  }

  if (!SELECTOR_ACTIONS.has(action.kind)) {
    return { kind: "manual", text: `unsupported action "${action.kind}" — resolve manually` };
  }

  const act = action as Extract<Action, { sel: Selector }>;
  const sel = act.sel;
  if (sel.prev) {
    // "that card" (M3): bind to the previous action's chosen targets; cards
    // that already left their area drop out (8-1-2 to the extent possible)
    const targets = running.lastTargets.filter((t) =>
      FIELD_ZONES.has(sel.zone) ? isOnField(state, t.owner, t.iid) : true);
    return { kind: "apply", targets };
  }
  if (sel.self) {
    // the compiled card itself (no choice) — only if still on the field
    const onField = findOnField(state, running.sourceIid);
    return { kind: "apply", targets: onField ? [onField] : [] };
  }
  let candidates = resolveSelector(db, state, controller, running.sourceIid, sel);
  // 10-2-1-2: K.O. moves a CHARACTER from the character area — leaders and
  // non-field cards can never be K.O. targets. 10-2-1-3: "cannot be K.O.'d"
  // covers effect K.O.; cannotBeKOdInBattle does not.
  if (action.kind === "koTarget") {
    candidates = candidates.filter(({ owner, iid }) =>
      state.players[owner].zones.characterArea.includes(iid)
      && !hasRestriction(state, owner, iid, "cannotBeKOd"));
  }
  // playing by effect needs room in the character area (3-7-6; no replace-by-
  // rule for effect plays — M1 decision, "to the extent possible" 8-1-2)
  let count = sel.count;
  if (action.kind === "playFromZone") {
    const room = 5 - state.players[controller].zones.characterArea.length;
    if (room <= 0) return { kind: "apply", targets: [] };
    count = Math.min(count, room);
  }
  if (candidates.length === 0) return { kind: "apply", targets: [] };
  if (!sel.upTo && candidates.length <= count) return { kind: "apply", targets: candidates }; // 8-4-4-1
  const chooser = sel.chooser === "opponent" ? opponentOf(state, controller) : controller;
  return { kind: "choose", chooser, candidates, count, upTo: sel.upTo ?? false };
}

/** Apply one action with its resolved targets, emitting events. */
export function applyAction(
  db: CardDb, state: AutoGameState, log: GameEvent[],
  controller: PID, running: RunningEffect, action: Action, targets: TargetRef[],
): void {
  // "that card" bookkeeping (M3): remember the targets this action used,
  // unless the action itself was a prev-binding
  const hasSel = (a: Action): a is Extract<Action, { sel: Selector }> => "sel" in a;
  if (hasSel(action) && !action.sel.prev) running.lastTargets = targets;

  switch (action.kind) {
    case "draw":
      drawCards(state, log, controller, action.count); // may end the game (deck-out)
      break;

    case "mill":
      for (const pid of whoToPids(state, controller, action.who)) {
        millCards(state, log, pid, action.count);
        if (state.phase === "over") return;
      }
      break;

    case "trashLife": // top Life card(s) to the trash (3-10 ordering)
      for (const pid of whoToPids(state, controller, action.who)) {
        const z = state.players[pid].zones;
        for (let i = 0; i < action.count && z.life.length > 0; i++) {
          emit(state, log, { type: "lifeCardTrashed", player: pid, iid: z.life[z.life.length - 1] });
        }
      }
      break;

    case "lifeToHand": // "add N from your Life to your hand" — top cards (3-10, secret area)
      for (const pid of whoToPids(state, controller, action.who)) {
        const z = state.players[pid].zones;
        for (let i = 0; i < action.count && z.life.length > 0; i++) {
          emit(state, log, { type: "lifeCardToHand", player: pid, iid: z.life[z.life.length - 1] });
        }
      }
      break;

    case "placeDonInCostArea": { // "add N DON!! from your DON!! deck" (tier-2)
      const n = Math.min(action.count, state.players[controller].don.deck);
      if (n > 0) emit(state, log, { type: "donAdded", player: controller, count: n, rested: action.rested ?? false });
      break;
    }

    case "standDon": { // "set up to N of your DON!! as active" — always max (no downside)
      const n = Math.min(action.count, state.players[controller].don.rested);
      if (n > 0) emit(state, log, { type: "donStood", player: controller, count: n });
      break;
    }

    case "returnDonToDeck": { // as an ACTION (rare): cost-area DON, rested first
      const don = state.players[controller].don;
      const fromRested = Math.min(action.count, don.rested);
      const fromActive = Math.min(action.count - fromRested, don.active);
      if (fromRested + fromActive > 0) {
        emit(state, log, { type: "donPaid", player: controller, fromActive, fromRested, fromGiven: {} });
      }
      break;
    }

    case "powerMod":
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "powerMod",
          targetOwner: t.owner, targetIid: t.iid, amount: action.amount,
          duration: action.duration, anchor: controller, createdTurn: state.turn,
        }});
      }
      break;

    case "costMod":
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "costMod",
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
        const given = state.players[t.owner].don.given[t.iid] ?? 0;
        // [On K.O.] activates on the field, resolves from the trash
        // (10-2-17-1/2) — fulfilled here, queued per 8-6.
        enqueueAutoEffects(db, state, t.owner, t.iid, "onKO", { fromTrash: true });
        // "when your opponent's Character is K.O.'d" (M3) fulfills for the
        // other player's cards
        enqueueKOdReactions(db, state, t.owner, t.iid);
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

    case "returnToHand": // bounce (M3)
      for (const t of targets) {
        if (!isOnField(state, t.owner, t.iid)) continue;
        emit(state, log, { type: "returnedToHand", player: t.owner, iid: t.iid });
      }
      break;

    case "returnToDeck": // "place at the top/bottom of the owner's deck" (M3)
      for (const t of targets) {
        if (!isOnField(state, t.owner, t.iid)) continue;
        emit(state, log, { type: "returnedToDeck", player: t.owner, iid: t.iid, where: action.where, from: "field" });
      }
      break;

    case "addFromTrashToHand": // (M3)
      for (const t of targets) {
        emit(state, log, { type: "trashToHand", player: t.owner, iid: t.iid });
      }
      break;

    case "giveRestedDon": { // "give N rested DON!! to ..." (M3)
      const don = state.players[controller].don;
      for (const t of targets) {
        const n = Math.min(action.count, don.rested); // 8-1-2 as much as possible
        if (n > 0) emit(state, log, { type: "donGivenFromRested", player: controller, targetIid: t.iid, count: n });
      }
      break;
    }

    case "playFromZone": {
      // [Trigger] "play this card" (10-1-5-3: the card is area-less right now)
      const tc = running.triggerCard;
      if (action.sel.self && tc) {
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
      // generic play from hand/trash (M3; free — the effect pays no DON)
      for (const t of targets) {
        const p = state.players[controller];
        if (p.zones.characterArea.length >= 5) break; // 3-7-6, no replace for effect plays
        const card = db(state.players[t.owner].instances[t.iid].cardId);
        if (card.category !== "Character") continue;
        emit(state, log, {
          type: "playedFromZone", player: t.owner, iid: t.iid,
          from: action.zone === "trash" ? "trash" : "hand", rested: action.rested ?? false,
        });
        // 10-2-6 [On Play] fires for effect plays too
        enqueueAutoEffects(db, state, t.owner, t.iid, "onPlay");
      }
      break;
    }

    case "ifThen": {
      // 8-3-3: resolve the branch inline by splicing it into the running
      // actions right after this one (conditions checked now)
      const branch = conditionsMet(db, state, controller, running.sourceIid, action.if)
        ? action.then
        : (action.else ?? []);
      running.actions.splice(running.actionIndex + 1, 0, ...branch);
      break;
    }

    default:
      break; // unreachable: planAction routed unsupported kinds to manualResolve
  }
}

/** "When your opponent's Character is K.O.'d" (M3): fulfilled on the OTHER
 *  player's field cards whenever a character is K.O.'d. */
export function enqueueKOdReactions(db: CardDb, state: AutoGameState, koOwner: PID, _koIid: Iid): void {
  const reactor = opponentOf(state, koOwner);
  const rp = state.players[reactor];
  for (const iid of [rp.leaderIid, ...rp.zones.characterArea, ...rp.zones.stage]) {
    enqueueAutoEffects(db, state, reactor, iid, "onOpponentCharacterKOd");
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
