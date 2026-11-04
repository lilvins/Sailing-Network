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
import type { Action, CompareOp, Condition, CostItem, Quantity, Selector, SelectorFilter, Timing } from "../ir/types";
import { emit, type GameEvent } from "./events";
import {
  attributesOf, effectiveBasePower, effectiveCost, effectivePower, hasRestriction, keywordsOf, opponentOf, ownTurnCount,
  type AutoGameState, type AutoInstance, type CardDb, type EngineCard, type Iid, type PID, type RunningEffect,
} from "./state";
import { enqueueAutoEffects, enqueueReactions } from "./triggers";
import { beginEffect, enqueueEventActivationReactions, shuffleDeck } from "./battle";
import { activeModifiers } from "./continuous";

export interface TargetRef { owner: PID; iid: Iid }

// ─── drawing (4-5) & milling ─────────────────────────────────────────────────

/** The deck of `player` is empty: a defeat (9-2-1-2) — or a win under a Leader rule (M5). */
export function deckOut(state: AutoGameState, log: GameEvent[], player: PID): void {
  if (state.players[player].deckOutAtEnd) return; // a Leader rule: the defeat comes at the end of the turn (M5, battle.ts)
  const wins = !!state.players[player].deckOutWins;
  emit(state, log, { type: "gameEnded", winner: wins ? player : opponentOf(state, player), reason: wins ? "deckOutWin" : "deckOut" });
}

/** A draw by an effect (outside the Draw Phase): answers "When you draw a
 *  card outside of your Draw Phase" (M5). */
export function effectDraw(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, count: number): void {
  const before = state.players[player].zones.deck.length;
  drawCards(state, log, player, count);
  if (state.phase !== "over" && state.players[player].zones.deck.length < before) {
    for (const iid of fieldOf(state, player)) enqueueAutoEffects(db, state, player, iid, "onDrawOutsideDrawPhase");
  }
}

export function drawCards(state: AutoGameState, log: GameEvent[], player: PID, count: number): void {
  const p = state.players[player];
  for (let i = 0; i < count; i++) {
    // defensive: an empty deck can't normally be reached (the game ends the
    // moment it empties, below) but a draw against it is still a defeat
    if (p.zones.deck.length === 0) {
      deckOut(state, log, player);
      return;
    }
    emit(state, log, { type: "cardsDrawn", player, iids: [p.zones.deck[0]] });
    // 1-2-1-1-2 + 9-1-2: 0 cards in deck is a defeat condition and rule
    // processing resolves IMMEDIATELY — drawing your last card loses on the
    // spot, not on the next draw attempt.
    if (p.zones.deck.length === 0) {
      deckOut(state, log, player);
      return;
    }
  }
}

/** Deck top → trash. Milling the last card is a defeat too (9-2-1-2). */
/** Top `count` cards of `player`'s deck → their Life (M5; as many as there are). */
export function addDeckTopToLife(state: AutoGameState, log: GameEvent[], player: PID, count: number, faceUp: boolean, where: "top" | "bottom"): void {
  for (const iid of state.players[player].zones.deck.slice(0, count)) {
    emit(state, log, { type: "addedToLife", player, iid, from: "deck", faceUp, where });
  }
}

export function millCards(state: AutoGameState, log: GameEvent[], player: PID, count: number): void {
  const p = state.players[player];
  const iids = p.zones.deck.slice(0, count);
  if (iids.length === 0) return;
  emit(state, log, { type: "milled", player, iids });
  if (p.zones.deck.length === 0) deckOut(state, log, player);
}

// ─── filters & selectors (plan §5 Selector) ──────────────────────────────────

/** Whether a card instance matches a selector filter. `onField` controls
 *  whether power is the effective (modified) value (8-1-3-3 recalc) or base. */
export function matchesFilter(
  db: CardDb, state: AutoGameState, owner: PID, iid: Iid,
  filter: SelectorFilter | undefined, sourceIid: Iid, onField: boolean,
): boolean {
  if (!filter) return true;
  if (matchesOne(db, state, owner, iid, filter, sourceIid, onField)) return true;
  // "… or [Name] / or Event card" (M5)
  return !!filter.or && matchesOne(db, state, owner, iid, filter.or, sourceIid, onField);
}

function matchesOne(
  db: CardDb, state: AutoGameState, owner: PID, iid: Iid,
  filter: SelectorFilter, sourceIid: Iid, onField: boolean,
): boolean {
  const inst = state.players[owner].instances[iid];
  const card = db(inst.cardId);
  if (filter.excludeSelf && iid === sourceIid) return false;
  if (filter.category && !filter.category.includes(card.category)) return false;
  if (filter.typeIncludes && !filter.typeIncludes.some((t) => card.types.includes(t))) return false;
  if (filter.colors && !filter.colors.some((c) => card.colors.includes(c))) return false;
  // 2-1-2: name matching needs the card name; a missing name never matches
  // "Also treat this card's name as [X]" (M5): X matches too
  const names = [card.name ?? "", ...(card.compiled?.rules?.alsoNames ?? [])].map((x) => x.toLowerCase());
  if (filter.nameIncludes) {
    if (!filter.nameIncludes.some((n) => names.some((name) => name.includes(n.toLowerCase())))) return false;
  }
  // "other than [Name]" (M2): a missing name never excludes
  if (filter.nameExcludes) {
    if (filter.nameExcludes.some((n) => names.some((name) => name !== "" && name.includes(n.toLowerCase())))) return false;
  }
  // "cost N or less" reads the CURRENT cost of a card on the field (cost
  // modifiers apply, floor 0); a Leader's `cost` slot is its Life (DB quirk)
  const cost = onField && card.category !== "Leader" ? effectiveCost(db, state, owner, iid) : (card.cost ?? 0);
  if (filter.costAtMost !== undefined && cost > filter.costAtMost) return false;
  if (filter.costAtLeast !== undefined && cost < filter.costAtLeast) return false;
  const power = onField ? effectivePower(db, state, owner, iid) : (card.power ?? 0);
  if (filter.powerAtMost !== undefined && power > filter.powerAtMost) return false;
  if (filter.powerAtLeast !== undefined && power < filter.powerAtLeast) return false;
  if (filter.rested !== undefined && inst.rested !== filter.rested) return false;
  if (filter.hasKeyword && !keywordsOf(db, state, owner, iid).has(filter.hasKeyword)) return false;
  if (filter.lacksKeyword && keywordsOf(db, state, owner, iid).has(filter.lacksKeyword)) return false; // M5
  if (!matchesFilterM5(state, inst, card, filter)) return false;
  if (onField && !filter.printedBase && (filter.basePowerAtMost !== undefined || filter.basePowerAtLeast !== undefined)) {
    const bp = effectiveBasePower(db, state, owner, iid); // "base power becomes N" counts (4-9)
    if (filter.basePowerAtMost !== undefined && bp > filter.basePowerAtMost) return false;
    if (filter.basePowerAtLeast !== undefined && bp < filter.basePowerAtLeast) return false;
  }
  if (filter.costAtMostQ) {
    const controller = ownerOfIid(state, sourceIid) ?? owner;
    if (cost > quantity(state, controller, filter.costAtMostQ, db)) return false;
  }
  if (filter.donGivenAtLeast !== undefined && (state.players[owner].don.given[iid] ?? 0) < filter.donGivenAtLeast) return false;
  if (filter.costEqualsGivenDon && cost !== (state.players[owner].don.given[iid] ?? 0)) return false; // M5
  if (filter.noBaseEffect && (card.hasEffect ?? !!card.compiled)) return false;
  const timings = (card.compiled?.effects ?? []).map((fx) => fx.timing);
  if (filter.hasTiming && !timings.includes(filter.hasTiming)) return false;
  if (filter.lacksTiming && timings.includes(filter.lacksTiming)) return false;
  return true;
}

/** The M5 filter fields: printed values, attributes, colors, [Trigger]… */
function matchesFilterM5(state: AutoGameState, inst: AutoInstance, card: EngineCard, filter: SelectorFilter): boolean {
  if (filter.typeExcludes && filter.typeExcludes.some((t) => card.types.includes(t))) return false;
  const attrs = attributesOf(state, inst.iid, card);
  if (filter.attributesExclude && filter.attributesExclude.some((a) => attrs.includes(a))) return false; // M5
  if (filter.attributes && !filter.attributes.some((a) => attrs.includes(a))) return false;
  if (filter.colorCountAtLeast !== undefined && card.colors.length < filter.colorCountAtLeast) return false;
  if (filter.colorCountAtMost !== undefined && card.colors.length > filter.colorCountAtMost) return false;
  const baseCost = card.cost ?? 0;
  if (filter.baseCostAtMost !== undefined && baseCost > filter.baseCostAtMost) return false;
  if (filter.baseCostAtLeast !== undefined && baseCost < filter.baseCostAtLeast) return false;
  const basePower = card.power ?? 0;
  if (filter.basePowerAtMost !== undefined && basePower > filter.basePowerAtMost) return false;
  if (filter.basePowerAtLeast !== undefined && basePower < filter.basePowerAtLeast) return false;
  if (filter.hasTrigger !== undefined) {
    const has = (card.compiled?.effects ?? []).some((fx) => fx.timing === "trigger");
    if (has !== filter.hasTrigger) return false;
  }
  if (filter.counter !== undefined && ((card.counter ?? 0) > 0 ? "some" : "none") !== filter.counter) return false;
  if (filter.playedThisTurn !== undefined && (inst.playedOnTurn === state.turn) !== filter.playedThisTurn) return false;
  if (filter.faceUp !== undefined && !!inst.faceUp !== filter.faceUp) return false;
  return true;
}

const FIELD_ZONES = new Set(["characterArea", "leader", "leaderOrCharacter", "stage", "leaderOrStage", "characterOrStage", "field"]);

/** "you cannot play Character cards (with a base cost of N or more) this
 *  turn" (M5) — applies to plays from the hand and by effects. */
export function playLocked(db: CardDb, state: AutoGameState, player: PID, iid: Iid, fromHand = false): boolean {
  const card = db(state.players[player].instances[iid].cardId);
  // "you cannot play cards from your hand during this turn" (M5) — Events are activated, not played
  if (fromHand && card.category !== "Event" && state.modifiers.some((m) => m.kind === "restriction" && m.restriction === "cannotPlayFromHand" && m.targetOwner === player)) return true;
  if (card.category !== "Character") return false;
  return state.modifiers.some((m) => m.kind === "restriction" && m.restriction === "cannotPlayCharacters"
    && m.targetOwner === player && (card.cost ?? 0) >= (m.amount ?? 0));
}

/** "you cannot draw cards using your own effects" (M5). */
export function drawLocked(state: AutoGameState, player: PID): boolean {
  return state.modifiers.some((m) => m.kind === "restriction" && m.restriction === "cannotDrawByOwnEffects" && m.targetOwner === player);
}

/** "you cannot add Life cards to your hand using your own effects" (M5). */
export function lifeLocked(state: AutoGameState, player: PID): boolean {
  return state.modifiers.some((m) => m.kind === "restriction" && m.restriction === "cannotTakeLifeByOwnEffects" && m.targetOwner === player);
}

/** Emit an event that takes a card out of a Life area, then answer "when
 *  your number of Life cards becomes 0" (M5). */
export function emitLife(db: CardDb, state: AutoGameState, log: GameEvent[], e: Extract<GameEvent, { player: PID; iid: Iid }>): void {
  const before = state.players[e.player].zones.life.length;
  emit(state, log, e);
  // "When a card is added to your hand from your Life" (M5)
  // "When a [Trigger] activates" (M5)
  if (e.type === "triggerActivated") for (const pid of state.order) enqueueReactions(db, state, pid, fieldOf(state, pid), "onTriggerActivated", { subjectOwner: e.player });
  if (e.type === "lifeCardToHand") for (const iid of fieldOf(state, e.player)) enqueueAutoEffects(db, state, e.player, iid, "onLifeToHand");
  if (before > 0 && state.players[e.player].zones.life.length === 0) {
    enqueueReactions(db, state, e.player, fieldOf(state, e.player), "onLifeZero", {});
  }
  // "When a card is removed from your or your opponent's Life cards" (M5)
  if (state.players[e.player].zones.life.length < before) {
    for (const pid of state.order) enqueueReactions(db, state, pid, fieldOf(state, pid), "onLifeRemoved", { subjectOwner: e.player });
  }
}

/** M5 watching timings: every Leader / Character / Stage of both players
 *  that waits for `timing` about the card (owner, iid) — `by` = the
 *  controller of the effect that caused it (undefined: no effect, e.g. battle). */
export function watchers(db: CardDb, state: AutoGameState, timing: Timing, owner: PID, iid: Iid, by: PID | undefined,
  extra?: { fromTrash?: boolean; source?: Iid }): void {
  const src = extra?.source;
  const srcOwner = src !== undefined ? ownerOfIid(state, src) : null;
  for (const pid of state.order) {
    enqueueReactions(db, state, pid, fieldOf(state, pid), timing, {
      by, subjectOwner: owner, subject: { owner, iid }, fromTrash: extra?.fromTrash,
      accept: (filter) => matchesFilter(db, state, owner, iid, filter, iid, isOnField(state, owner, iid)),
      acceptSource: (filter) => !!src && !!srcOwner && matchesFilter(db, state, srcOwner, src, filter, src, isOnField(state, srcOwner, src)),
    });
  }
}

/** Leader, Characters and Stage of a player. */
export function fieldOf(state: AutoGameState, pid: PID): Iid[] {
  const p = state.players[pid];
  return [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage];
}

/** "When DON!! cards on your field are returned to your DON!! deck" (M5). */
export function donReturned(db: CardDb, state: AutoGameState, pid: PID, count: number, by: PID | undefined): void {
  if (count > 0) enqueueReactions(db, state, pid, fieldOf(state, pid), "onYourDonReturned", { count, by });
}

/** "When this Character becomes rested" (M5) — `by` = the effect's controller, if an effect did it. */
export function becameRested(db: CardDb, state: AutoGameState, owner: PID, iid: Iid, by: PID | undefined): void {
  enqueueReactions(db, state, owner, [iid], "onRested", { by });
}

/** Which player owns an instance id (ids are unique across players). */
function ownerOfIid(state: AutoGameState, iid: Iid): PID | null {
  return state.order.find((pid) => !!state.players[pid].instances[iid]) ?? null;
}

/** M5 set constraints of a target choice: total cost / power, different names. */
export interface SetConstraints { totalCostAtMost?: number; totalPowerAtMost?: number; distinctNames?: boolean }

export function setConstraintsOf(sel: Selector): SetConstraints | null {
  const c: SetConstraints = {};
  if (sel.totalCostAtMost !== undefined) c.totalCostAtMost = sel.totalCostAtMost;
  if (sel.totalPowerAtMost !== undefined) c.totalPowerAtMost = sel.totalPowerAtMost;
  if (sel.distinctNames) c.distinctNames = true;
  return Object.keys(c).length > 0 ? c : null;
}

/** Whether a chosen set of targets satisfies the set constraints. */
export function satisfiesSet(db: CardDb, state: AutoGameState, targets: TargetRef[], c: SetConstraints): boolean {
  const cards = targets.map((t) => ({ t, card: db(state.players[t.owner].instances[t.iid].cardId) }));
  const onField = (t: TargetRef) => isOnField(state, t.owner, t.iid);
  if (c.totalCostAtMost !== undefined) {
    const total = cards.reduce((s, { t, card }) => s + (onField(t) ? effectiveCost(db, state, t.owner, t.iid) : (card.cost ?? 0)), 0);
    if (total > c.totalCostAtMost) return false;
  }
  if (c.totalPowerAtMost !== undefined) {
    const total = cards.reduce((s, { t, card }) => s + (onField(t) ? effectivePower(db, state, t.owner, t.iid) : (card.power ?? 0)), 0);
    if (total > c.totalPowerAtMost) return false;
  }
  if (c.distinctNames && new Set(cards.map(({ card }) => card.name ?? card.id)).size !== cards.length) return false;
  return true;
}

/** The legal subset of a pending selectTargets answer: `preferred` cut down
 *  to what the choice's set constraints allow (bots / drivers, M5). */
export function fitChoice(
  db: CardDb, state: AutoGameState,
  choice: { candidates: TargetRef[]; count: number } & SetConstraints, preferred: Iid[],
): Iid[] {
  const c: SetConstraints = { totalCostAtMost: choice.totalCostAtMost, totalPowerAtMost: choice.totalPowerAtMost, distinctNames: choice.distinctNames };
  const has = c.totalCostAtMost !== undefined || c.totalPowerAtMost !== undefined || !!c.distinctNames;
  const refs = preferred.map((iid) => choice.candidates.find((x) => x.iid === iid)!);
  return fitSelection(db, state, refs, has ? c : null, choice.count).map((t) => t.iid);
}

/** Keep the longest prefix of `preferred` that satisfies the constraints
 *  (greedy: each card is kept if it still fits) — for bots and drivers. */
export function fitSelection(db: CardDb, state: AutoGameState, preferred: TargetRef[], c: SetConstraints | null, max: number): TargetRef[] {
  const out: TargetRef[] = [];
  for (const t of preferred) {
    if (out.length >= max) break;
    if (!c || satisfiesSet(db, state, [...out, t], c)) out.push(t);
  }
  return out;
}

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
      case "leaderOrStage": pool = [p.leaderIid, ...p.zones.stage]; break;
      case "characterOrStage": pool = [...p.zones.characterArea, ...p.zones.stage]; break;
      case "field": pool = [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage]; break;
      case "life": pool = [...p.zones.life]; break;
      case "deckTop": pool = p.zones.deck.slice(0, sel.count); break; // M5: "from the top of your deck"
      case "lifeTop": pool = p.zones.life.slice(-1); break; // M5: the top Life card
      default: pool = []; // costArea selectors land later
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
  running?: RunningEffect,
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
      case "compare": {
        const left = quantity(state, controller, c.left, db);
        const right = typeof c.right === "number" ? c.right : quantity(state, controller, c.right, db);
        return compareWith(c.op, left, right);
      }
      case "anyOf": return c.conditions.some((x) => conditionsMet(db, state, controller, sourceIid, [x]));
      case "allOf": return conditionsMet(db, state, controller, sourceIid, c.conditions);
      case "attackerMatches": { // M5
        const b = state.battle;
        return !!b && matchesFilter(db, state, b.attackerOwner, b.attackerIid, c.filter, sourceIid, true);
      }
      case "deckTopMatches": return whoToPids(state, controller, c.who).every((pid) => { // M5
        const top = state.players[pid].zones.deck[0];
        return top !== undefined && matchesFilter(db, state, pid, top, c.filter, sourceIid, false);
      });
      case "prevMatches": return !!running && running.lastTargets.length > 0 // M5
        && running.lastTargets.every((t) => matchesFilter(db, state, t.owner, t.iid, c.filter, sourceIid, isOnField(state, t.owner, t.iid)));
      case "prevInTrash": return !!running && running.lastTargets.length > 0 // M5
        && running.lastTargets.every((t) => state.players[t.owner].zones.trash.includes(t.iid));
      case "attackingLeader": { // M5
        const b = state.battle;
        return !!b && b.attackerIid === sourceIid && b.targetIid === state.players[b.defenderOwner].leaderIid;
      }
      case "selfMatches": {
        const on = findOnField(state, sourceIid);
        return !!on && matchesFilter(db, state, on.owner, sourceIid, c.filter, sourceIid, true);
      }
      case "ownTurnAtLeast": return ownTurnCount(state, controller) >= c.count; // 6-1
      case "lifeTop": return whoToPids(state, controller, c.who).every((pid) => {
        const p = state.players[pid];
        const top = p.zones.life[p.zones.life.length - 1];
        return top !== undefined && !!p.instances[top].faceUp === c.faceUp;
      });
      case "hadTargets": return !running || running.lastTargets.length > 0;
      case "happenedThisTurn": return whoToPids(state, controller, c.who).some((pid) => !!state.players[pid].thisTurn?.[c.what]);
      case "milledMatches": return (running?.lastMilled ?? []).some((t) => matchesFilter(db, state, t.owner, t.iid, c.filter, sourceIid, false));
      case "activatedEventThisTurn": return (state.players[controller].eventsThisTurn ?? []).some((c2) => c2 >= c.minBaseCost);
      case "deckTopCostDeclared": return whoToPids(state, controller, c.who).every((pid) => {
        const top = state.players[pid].zones.deck[0];
        return top !== undefined && running?.declared !== undefined && (db(state.players[pid].instances[top].cardId).cost ?? 0) === running.declared;
      });
    }
  });
}

function compareWith(op: CompareOp, a: number, b: number): boolean {
  switch (op) {
    case "lt": return a < b;
    case "le": return a <= b;
    case "eq": return a === b;
    case "ge": return a >= b;
    case "gt": return a > b;
  }
}



/** A number read from the state for `compare` (4-4: DON on the field = cost
 *  area + given; "rested cards" = rested Leader/Characters/Stage + rested DON). */
export function quantity(state: AutoGameState, controller: PID, q: Quantity, db: CardDb): number {
  const one = (pid: PID): number => {
    const p = state.players[pid];
    const given = Object.values(p.don.given).reduce((s, n) => s + n, 0);
    switch (q.count) {
      case "life": return p.zones.life.length;
      case "hand": return p.zones.hand.length;
      case "deck": return p.zones.deck.length;
      case "trash": return p.zones.trash.length;
      case "trashEvents": return p.zones.trash.filter((iid) => db(p.instances[iid].cardId).category === "Event").length;
      case "characters": return p.zones.characterArea.length;
      case "donOnField": return p.don.active + p.don.rested + given;
      case "donGiven": return given;
      case "donActive": return p.don.active;
      case "donRested": return p.don.rested;
      case "lifeTopCost": { // M5
        const top = p.zones.life[p.zones.life.length - 1];
        return top === undefined ? 0 : db(p.instances[top].cardId).cost ?? 0;
      }
      case "distinctNames": { // "for each of your Characters with a different card name" (M5)
        const names = new Set(p.zones.characterArea.map((iid) => db(p.instances[iid].cardId).name ?? iid));
        return names.size;
      }
      case "lifeAndHand": return p.zones.life.length + p.zones.hand.length; // M5
      case "charactersTotalCost": // M5
        return p.zones.characterArea.reduce((s, iid) => s + (db(p.instances[iid].cardId).cost ?? 0), 0);
      case "restedCards":
        return [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage].filter((iid) => p.instances[iid].rested).length + p.don.rested;
    }
  };
  return whoToPids(state, controller, q.who).reduce((sum, pid) => sum + one(pid), 0) + (q.plus ?? 0);
}

// ─── activation costs (8-3-1) — payable check ────────────────────────────────

/** Whether an Event's [Main] cost can be paid once the Event itself is played:
 *  its own DON!! are rested and it has left the hand (2-7-3 / 8-4-2), so
 *  neither can pay the [Main] cost too. */
export function canPayEventMainCost(
  db: CardDb, state: AutoGameState, player: PID, eventIid: Iid, cardCost: number, cost: CostItem[] | undefined,
): boolean {
  const p = state.players[player];
  const played: AutoGameState = { ...state, players: { ...state.players, [player]: {
    ...p,
    don: { ...p.don, active: p.don.active - cardCost, rested: p.don.rested + cardCost },
    zones: { ...p.zones, hand: p.zones.hand.filter((iid) => iid !== eventIid) },
  } } };
  return canPayCost(db, played, player, eventIid, cost);
}

/** Whether the FULL activation cost can be paid right now (8-3-1-3). Payment
 *  itself happens item by item in the pump (choices may pause it). */
export function canPayCost(
  db: CardDb, state: AutoGameState, player: PID, sourceIid: Iid, cost: CostItem[] | undefined,
): boolean {
  if (!cost || cost.length === 0) return true;
  // "X or Y:" (M5): payable when one option, with the rest of the cost, is
  const alt = cost.findIndex((c) => c.kind === "oneOf");
  if (alt >= 0) {
    const item = cost[alt] as Extract<CostItem, { kind: "oneOf" }>;
    return item.options.some((opt) => canPayCost(db, state, player, sourceIid, [...cost.slice(0, alt), ...opt, ...cost.slice(alt + 1)]));
  }
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
      case "lifeToHand":
        if (lifeLocked(state, player)) return false;
        lifeNeed += c.count;
        break;
      case "trashFromLife":
        lifeNeed += c.count;
        break;
      case "handToDeckBottom":
        handNeed += c.count;
        break;
      case "action":
        if (!canPerformFully(db, state, player, sourceIid, c.action)) return false;
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

/** Whether an action used as a cost (M5) can be performed in full now. */
export function canPerformFully(db: CardDb, state: AutoGameState, player: PID, sourceIid: Iid, action: Action): boolean {
  // the player the action is about ("your opponent trashes 1 Life card", M5)
  const whose = "who" in action && action.who === "opponent" ? opponentOf(state, player) : player;
  const p = state.players[whose];
  switch (action.kind) {
    case "mill": return p.zones.deck.length >= action.count;
    case "flipLife": // the top card(s) must be there and not already turned that way
      return p.zones.life.length >= action.count
        && (action.bottom ? p.zones.life.slice(0, action.count) : p.zones.life.slice(-action.count)).every((iid) => !!p.instances[iid].faceUp !== action.faceUp);
    case "lifeToHand": if (action.who !== "opponent" && lifeLocked(state, player)) return false; return p.zones.life.length >= action.count;
    case "trashLife": return p.zones.life.length >= action.count;
    case "ungiveDon": return Object.values(p.don.given).reduce((s, n) => s + n, 0) >= action.count; // M5
    case "returnDonToDeck":
      if (action.activeOnly) return p.don.active >= action.count;
      return p.don.active + p.don.rested + Object.values(p.don.given).reduce((s, n) => s + n, 0) >= action.count;
    default: break;
  }
  if (!("sel" in action)) return true;
  if (action.sel.prev) return true; // bound when it resolves (a replacement's protected card, M5)
  if (action.sel.self) {
    const on = findOnField(state, sourceIid);
    if (!on) return false;
    return action.kind !== "restTarget" || !state.players[on.owner].instances[sourceIid].rested;
  }
  let candidates = actionCandidates(db, state, player, sourceIid, action);
  if (action.kind === "restTarget") candidates = candidates.filter((t) => !state.players[t.owner].instances[t.iid].rested);
  return candidates.length >= action.sel.count;
}

// ─── action planning & application ───────────────────────────────────────────

/** What the pump should do with the next action of a running effect. */
export type ActionPlan =
  | { kind: "apply"; targets: TargetRef[] }
  | { kind: "choose"; chooser: PID; candidates: TargetRef[]; count: number; upTo: boolean; set?: SetConstraints }
  | { kind: "peek" }                       // handled by the pump (peekSelect window)
  | { kind: "chooseNumber"; max: number; purpose?: "draw" | "life" | "declare" | "restDon" | "addDon" | "standDon" }  // "draw up to N", "add up to N to Life"
  | { kind: "chooseOption"; labels: string[] } // "Choose one:" (M5)
  | { kind: "arrangeLife"; owner: PID; toDeckTop: number } // M5
  | { kind: "damage" } // M5: "deal N damage"
  | { kind: "manual"; text: string };

const SELECTOR_ACTIONS = new Set<Action["kind"]>([
  "powerMod", "koTarget", "restTarget", "standTarget", "discard", "grantKeyword",
  "restriction", "costMod", "activateEvent", "moveGivenDon", "swapBasePower",
  // tier-2 (M3)
  "returnToHand", "returnToDeck", "playFromZone", "addFromTrashToHand", "giveRestedDon",
  // M5
  "trashTarget", "reveal", "giveActiveDon", "addToLife", "select", "setBasePower", "negateEffect", "redirectAttack",
]);
const NO_TARGET_ACTIONS = new Set<Action["kind"]>([
  "draw", "mill", "trashLife", "lifeToHand", "placeDonInCostArea", "standDon", "flipLife",
  "restDon", "lifeTopToBottom", "peekLife", "scheduleEndOfTurn",
  "returnDonToDeck", "ifThen", "shuffleDeck", "shuffleHandIntoDeck", "winGame", "takeExtraTurn", "nextPlayDiscount", "freezeDon", "ungiveDon",
]);

type SelAction = Extract<Action, { sel: Selector }>;

/** Actions that remove a card from the field (M5: removal immunity). */
const REMOVALS = new Set<Action["kind"]>(["koTarget", "returnToHand", "returnToDeck", "trashTarget", "addToLife"]);

/** "cannot be K.O.'d by effects of (your opponent's) Characters …" (M5): the
 *  card whose effect is K.O.ing matches the restriction's source filter. */
function koImmuneFromSource(db: CardDb, state: AutoGameState, owner: PID, iid: Iid, controller: PID, sourceIid: Iid): boolean {
  const mods = activeModifiers(db, state).filter((m) => m.kind === "restriction" && m.restriction === "cannotBeKOdByEffectsOf"
    && m.targetOwner === owner && m.targetIid === iid && (!m.sourceOpponentOnly || controller !== owner));
  if (mods.length === 0) return false;
  const srcOwner = ownerOfIid(state, sourceIid);
  if (!srcOwner) return false;
  return mods.some((m) => matchesFilter(db, state, srcOwner, sourceIid, m.sourceFilter, sourceIid, isOnField(state, srcOwner, sourceIid)));
}

/** The legal targets of a selector action right now (8-4-4), with the
 *  per-action rules on top of the selector. */
export function actionCandidates(db: CardDb, state: AutoGameState, controller: PID, sourceIid: Iid, action: SelAction): TargetRef[] {
  let candidates = resolveSelector(db, state, controller, sourceIid, action.sel);
  // "cannot be removed from the field by your opponent's effects" (M5)
  if (REMOVALS.has(action.kind)) {
    candidates = candidates.filter(({ owner, iid }) => owner === controller || !isOnField(state, owner, iid)
      || !hasRestriction(db, state, owner, iid, "cannotBeRemovedByOpponent"));
  }
  switch (action.kind) {
    // 10-2-1-2: K.O. moves a CHARACTER from the character area — leaders and
    // non-field cards can never be K.O. targets (a Stage only when the effect
    // names Stages). 10-2-1-3: "cannot be K.O.'d" covers effect K.O.;
    // cannotBeKOdInBattle does not.
    case "koTarget":
      return candidates.filter(({ owner, iid }) => {
        const z = state.players[owner].zones;
        return (z.characterArea.includes(iid) || (z.stage.includes(iid) && (action.sel.zone === "stage" || action.sel.zone === "characterOrStage")))
          && !hasRestriction(db, state, owner, iid, "cannotBeKOd")
          && !(owner !== controller && hasRestriction(db, state, owner, iid, "cannotBeKOdByOpponent"))
          && !koImmuneFromSource(db, state, owner, iid, controller, sourceIid);
      });
    case "trashTarget": // a Character or Stage on the field (never the Leader)
      return candidates.filter(({ owner, iid }) => {
        const z = state.players[owner].zones;
        return z.characterArea.includes(iid) || z.stage.includes(iid);
      });
    case "restTarget": // "cannot be rested" (M5)
      return candidates.filter(({ owner, iid }) => !hasRestriction(db, state, owner, iid, "cannotBeRested")
        && !(owner !== controller && hasRestriction(db, state, owner, iid, "cannotBeRestedByOpponent")));
    case "giveActiveDon": // needs active DON!! in the cost area of the card's owner
      return candidates.filter((t) => state.players[t.owner].don.active >= action.count);
    case "giveRestedDon": // "give 1 of your opponent's rested DON!! to 1 of their Characters" (M5): the owner's DON
      return candidates.filter((t) => state.players[t.owner].don.rested > 0);
    default:
      return candidates;
  }
}

/** Resolve the legal target set of a selector-based action and decide whether
 *  a choice is needed (8-4-4). Forced choices auto-resolve: 8-4-4-1 — the
 *  player must choose as many as they can up to the number specified. */
export function planAction(
  db: CardDb, state: AutoGameState, controller: PID, running: RunningEffect, action: Action,
): ActionPlan {
  if (action.kind === "draw") {
    if (drawLocked(state, controller) && action.who !== "opponent") return { kind: "apply", targets: [] };
    if (action.who === "opponent") return { kind: "apply", targets: [] };
    // "draw up to N": the player picks how many (8-4-4-1 allows 0)
    if (action.upTo && action.count > 0) return { kind: "chooseNumber", max: action.count };
    return { kind: "apply", targets: [] };
  }
  if (action.kind === "standDon" && action.upTo) { // "set up to N of your DON!! as active" (M5)
    const max = Math.min(action.count, state.players[controller].don.rested);
    return max > 0 ? { kind: "chooseNumber", max, purpose: "standDon" } : { kind: "apply", targets: [] };
  }
  if (action.kind === "placeDonInCostArea" && action.upTo) { // "add up to N DON!!" (M5)
    const max = Math.min(action.count, state.players[controller].don.deck);
    return max > 0 ? { kind: "chooseNumber", max, purpose: "addDon" } : { kind: "apply", targets: [] };
  }
  if (action.kind === "restDon" && action.upTo) { // "rest any number of your DON!!" (M5)
    const active = state.players[action.who === "opponent" ? opponentOf(state, controller) : controller].don.active;
    if (action.who === "self" && active > 0) return { kind: "chooseNumber", max: Math.min(active, action.count), purpose: "restDon" };
  }
  if (NO_TARGET_ACTIONS.has(action.kind)) return { kind: "apply", targets: [] };

  if (action.kind === "declareCost") return { kind: "chooseNumber", max: 10, purpose: "declare" };
  if (action.kind === "dealDamage") return { kind: "damage" };
  if (action.kind === "arrangeLife") {
    const owner = action.who === "opponent" ? opponentOf(state, controller) : controller;
    if (state.players[owner].zones.life.length === 0) return { kind: "apply", targets: [] };
    return { kind: "arrangeLife", owner, toDeckTop: Math.min(action.toDeckTop ?? 0, state.players[owner].zones.life.length) };
  }
  if (action.kind === "peekDeck") {
    const t = action.then;
    // "reveal 1 card from the top of your opponent's deck" with nothing taken (M5)
    if (action.who !== "self" && !t.addToHand && !t.play && !t.toLife && t.rest === "topAnyOrder") return { kind: "apply", targets: [] };
    if (action.who !== "self") return { kind: "manual", text: "peeking the opponent's deck is not auto-executable yet — resolve manually" };
    return { kind: "peek" };
  }

  if (action.kind === "manual") return { kind: "manual", text: action.text };

  // "add up to N cards from the top of your deck to the top of your Life" (M5)
  if (action.kind === "addToLife" && action.sel.zone === "deckTop" && !action.sel.prev) {
    const deck = state.players[action.sel.owner === "opponent" ? opponentOf(state, controller) : controller].zones.deck.length;
    const max = Math.min(action.sel.count, deck);
    if (action.sel.upTo && max > 0) return { kind: "chooseNumber", max, purpose: "life" };
    return { kind: "apply", targets: [] };
  }

  if (action.kind === "chooseOne") {
    return { kind: "chooseOption", labels: action.options.map((_, i) => action.labels?.[i] ?? `Option ${i + 1}`) };
  }
  if (action.kind === "mayPay") {
    // "you may X. If you do, Y" (M5): only offered when X can be paid in full
    if (!canPayCost(db, state, controller, running.sourceIid, action.cost)) return { kind: "apply", targets: [] };
    return { kind: "chooseOption", labels: [action.label ?? "Pay", "Don't"] };
  }

  if (action.kind === "playFromZone" && action.zone === "revealed") {
    return { kind: "manual", text: "playFromZone (revealed) is not auto-executable yet — resolve manually" };
  }

  if (!SELECTOR_ACTIONS.has(action.kind)) {
    return { kind: "manual", text: `unsupported action "${action.kind}" — resolve manually` };
  }

  const act = action as Extract<Action, { sel: Selector }>;
  let sel = act.sel;
  if (act.kind === "discard" && act.keepInHand !== undefined) {
    // "trash cards from your hand until you have 5 cards in your hand" (M5): exactly the excess
    const owner = sel.owner === "opponent" ? opponentOf(state, controller) : controller;
    const n = Math.max(0, state.players[owner].zones.hand.length - act.keepInHand);
    if (n === 0) return { kind: "apply", targets: [] };
    sel = { ...sel, count: n, upTo: false };
  }
  if (act.kind === "discard" && act.countFromPrev) { // "trash the same number of cards from your hand" (M5)
    const n = running.lastCount ?? running.lastTargets.length;
    if (n === 0) return { kind: "apply", targets: [] };
    sel = { ...sel, count: n, upTo: false };
  }
  if (sel.prev) {
    // "that card" (M3): bind to the previous action's chosen targets; cards
    // that already left their area drop out (8-1-2 to the extent possible)
    const targets = running.lastTargets.filter((t) =>
      (FIELD_ZONES.has(sel.zone) ? isOnField(state, t.owner, t.iid) : true)
      // M5: "the opponent's Character you battled with" (cost 5 or less) — a filter on the bound card
      && (!sel.filter || matchesFilter(db, state, t.owner, t.iid, sel.filter, running.sourceIid, isOnField(state, t.owner, t.iid))));
    return { kind: "apply", targets };
  }
  if (sel.self) {
    // the compiled card itself (no choice) — only if still on the field
    const onField = findOnField(state, running.sourceIid);
    return { kind: "apply", targets: onField ? [onField] : [] };
  }
  let candidates = actionCandidates(db, state, controller, running.sourceIid, action as SelAction);
  if (sel.filter?.sameNameAsPrev) { // M5
    const prev = running.lastTargets[0];
    const name = prev ? db(state.players[prev.owner].instances[prev.iid].cardId).name : undefined;
    candidates = candidates.filter((t) => !!name && db(state.players[t.owner].instances[t.iid].cardId).name === name && t.iid !== prev!.iid);
  }
  if (sel.filter?.notPrev) candidates = candidates.filter((t) => !running.lastTargets.some((p) => p.iid === t.iid && p.owner === t.owner)); // M5: "the other"
  if (sel.filter?.otherColorThanPrev) {
    // "a different color than the returned Character" (M5)
    const prev = running.lastTargets[0];
    const colors = prev ? db(state.players[prev.owner].instances[prev.iid].cardId).colors : [];
    candidates = candidates.filter((t) => !db(state.players[t.owner].instances[t.iid].cardId).colors.some((c) => colors.includes(c)));
  }
  // playing by effect needs room in the character area (3-7-6; no replace-by-
  // rule for effect plays — M1 decision, "to the extent possible" 8-1-2)
  let count = sel.count;
  if (action.kind === "playFromZone") {
    const owner = sel.owner === "opponent" ? opponentOf(state, controller) : controller;
    const room = 5 - state.players[owner].zones.characterArea.length;
    // a Stage needs no Character room (M5)
    if (room <= 0 && !candidates.some((t) => db(state.players[t.owner].instances[t.iid].cardId).category === "Stage")) return { kind: "apply", targets: [] };
    count = Math.min(count, Math.max(room, candidates.some((t) => db(state.players[t.owner].instances[t.iid].cardId).category === "Stage") ? 1 : 0));
  }
  if (candidates.length === 0) return { kind: "apply", targets: [] };
  const set = setConstraintsOf(sel);
  if (set) {
    // "with a total cost of N or less" (M5): the chooser picks a fitting set
    if (!sel.upTo && candidates.length <= count && satisfiesSet(db, state, candidates, set)) return { kind: "apply", targets: candidates };
    const chooser = sel.chooser === "opponent" ? opponentOf(state, controller) : controller;
    return { kind: "choose", chooser, candidates, count, upTo: true, set };
  }
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
  const prevCount = running.lastCount ?? running.lastTargets.length; // "for every card trashed / DON!! rested this way" (M5)
  const prevSources = [...running.lastTargets];
  const prev = running.lastTargets[0];
  if (hasSel(action) && !action.sel.prev) { running.lastTargets = targets; delete running.lastCount; }

  switch (action.kind) {
    case "draw":
      if (action.who === "opponent") { effectDraw(db, state, log, opponentOf(state, controller), action.count); break; } // "your opponent draws N" (M5)
      if (drawLocked(state, controller)) break; // "you cannot draw cards using your own effects" (M5)
      effectDraw(db, state, log, controller, action.countFromPrev ? prevCount : action.count); // may end the game (deck-out)
      break;

    case "mill":
      running.lastMilled = [];
      for (const pid of whoToPids(state, controller, action.who)) {
        const n = action.countFromPrev ? prevCount : action.count;
        running.lastMilled.push(...state.players[pid].zones.deck.slice(0, n).map((iid) => ({ owner: pid, iid })));
        millCards(state, log, pid, n);
        if (state.phase === "over") return;
      }
      break;

    case "trashLife": // top Life card(s) to the trash (3-10 ordering)
      for (const pid of whoToPids(state, controller, action.who)) {
        const z = state.players[pid].zones;
        if (action.faceUpOnly) { // "Trash all your face-up Life cards" (M5)
          for (const iid of z.life.filter((x) => state.players[pid].instances[x].faceUp)) emitLife(db, state, log, { type: "lifeCardTrashed", player: pid, iid });
          continue;
        }
        const n = action.untilLeft !== undefined ? Math.max(0, z.life.length - action.untilLeft) : action.count;
        for (let i = 0; i < n && z.life.length > 0; i++) {
          emitLife(db, state, log, { type: "lifeCardTrashed", player: pid, iid: z.life[z.life.length - 1] });
        }
      }
      break;

    case "lifeToHand": // "add N from your Life to your hand" — top cards (3-10, secret area)
      for (const pid of whoToPids(state, controller, action.who)) {
        if (pid === controller && lifeLocked(state, pid)) continue;
        const z = state.players[pid].zones;
        for (let i = 0; i < action.count && z.life.length > 0; i++) {
          emitLife(db, state, log, { type: "lifeCardToHand", player: pid, iid: action.bottom ? z.life[0] : z.life[z.life.length - 1] });
        }
      }
      break;

    case "placeDonInCostArea": { // "add N DON!! from your DON!! deck" (tier-2)
      const n = Math.min(action.count, state.players[controller].don.deck);
      if (n > 0) emit(state, log, { type: "donAdded", player: controller, count: n, rested: action.rested ?? false });
      break;
    }

    case "standDon": { // "set up to N of your DON!! as active" — always max (no downside)
      const src = state.players[controller].instances[running.sourceIid];
      if (src && db(src.cardId).category === "Character" && state.modifiers.some((m) => m.kind === "restriction"
        && m.restriction === "cannotStandDonByCharacters" && m.targetOwner === controller)) break; // M5
      const n = Math.min(action.count, state.players[controller].don.rested);
      if (n > 0) emit(state, log, { type: "donStood", player: controller, count: n });
      break;
    }

    case "returnDonToDeck": { // as an ACTION (rare): cost-area DON, rested first ("active DON!!" = active only, M5)
      for (const pid of whoToPids(state, controller, action.who)) {
        const don = state.players[pid].don;
        const onField = (q: PID) => { const d = state.players[q].don; return d.active + d.rested + Object.values(d.given).reduce((s, n) => s + n, 0); };
        const count = action.downToOpponent ? Math.max(0, onField(pid) - onField(opponentOf(state, pid))) : action.count;
        const fromRested = action.activeOnly ? 0 : Math.min(count, don.rested);
        const fromActive = Math.min(count - fromRested, don.active);
        // "DON!! cards from your field" (M5): given DON!! too, once the cost area is empty
        const fromGiven: Record<Iid, number> = {};
        let left = action.downToOpponent ? count - fromRested - fromActive : 0;
        for (const [iid, n] of Object.entries(don.given)) { if (left <= 0) break; const k = Math.min(n, left); fromGiven[iid] = k; left -= k; }
        const total = fromRested + fromActive + Object.values(fromGiven).reduce((s, n) => s + n, 0);
        if (total > 0) {
          emit(state, log, { type: "donPaid", player: pid, fromActive, fromRested, fromGiven });
          donReturned(db, state, pid, total, controller);
        }
      }
      break;
    }

    case "powerMod":
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "powerMod",
          targetOwner: t.owner, targetIid: t.iid,
          amount: action.perPrevTarget ? action.amount * (action.perPrevEvery ? Math.floor(prevCount / action.perPrevEvery) : prevCount)
            : action.perGivenDon ? action.amount * (state.players[t.owner].don.given[t.iid] ?? 0)
            : action.scale ? action.amount * Math.floor(quantity(state, controller, action.scale.q, db) / action.scale.per) // M5, fixed now
            : action.toZero ? -effectivePower(db, state, t.owner, t.iid)
            : action.amount,
          duration: action.duration, anchor: controller, createdTurn: state.turn,
        }});
      }
      break;

    case "setBasePower": // "base power becomes N" (4-9, M5)
      if (action.amountFromPrev && (!prev || !isOnField(state, prev.owner, prev.iid))) break;
      if (action.fromAttackerPower && !state.battle) break;
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "basePower",
          targetOwner: t.owner, targetIid: t.iid,
          amount: action.amountFromPrev ? effectivePower(db, state, prev.owner, prev.iid)
            : action.fromAttackerPower ? effectivePower(db, state, state.battle!.attackerOwner, state.battle!.attackerIid) : action.amount,
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
          ...(action.amount !== undefined ? { amount: action.amount } : {}),
          ...(action.attributes ? { attributes: action.attributes } : {}),
          ...(action.attackerCharactersOnly ? { attackerCharactersOnly: true } : {}),
          ...(action.attackerLeadersOnly ? { attackerLeadersOnly: true } : {}),
          ...(action.exceptAttributes ? { exceptAttributes: action.exceptAttributes } : {}),
          ...(action.sourceFilter ? { sourceFilter: action.sourceFilter } : {}),
          ...(action.sourceOpponentOnly ? { sourceOpponentOnly: true } : {}),
        }});
      }
      break;

    case "ungiveDon": { // M5 — given DON!! back to the cost area, rested (field order)
      const from: Record<Iid, number> = {};
      let left = action.count;
      for (const [iid, n] of Object.entries(state.players[controller].don.given)) { if (left <= 0) break; const k = Math.min(n, left); from[iid] = k; left -= k; }
      if (Object.keys(from).length > 0) emit(state, log, { type: "donUngiven", player: controller, from });
      break;
    }

    case "negateEffect": // M5: "Negate the effect of …"
      for (const t of targets) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "restriction", targetOwner: t.owner, targetIid: t.iid,
          restriction: "effectsNegated", duration: action.duration, anchor: controller, createdTurn: state.turn } });
      }
      break;

    case "redirectAttack": // M5: "Change the attack target to the selected card"
      if (state.battle && targets[0] && targets[0].owner === state.battle.defenderOwner) {
        emit(state, log, { type: "attackRedirected", targetIid: targets[0].iid });
      }
      break;

    case "koTarget":
      for (const t of targets) {
        const z = state.players[t.owner].zones;
        if (z.stage.includes(t.iid)) { emit(state, log, { type: "characterTrashedByRule", player: t.owner, iid: t.iid }); continue; } // a K.O.'d Stage
        if (!z.characterArea.includes(t.iid)) continue; // left already
        const given = state.players[t.owner].don.given[t.iid] ?? 0;
        // [On K.O.] activates on the field, resolves from the trash
        // (10-2-17-1/2) — fulfilled here, queued per 8-6.
        enqueueAutoEffects(db, state, t.owner, t.iid, "onKO", { fromTrash: true });
        // "when your opponent's Character is K.O.'d" (M3) fulfills for the
        // other player's cards
        enqueueKOdReactions(db, state, t.owner, t.iid);
        enqueueReactions(db, state, t.owner, [t.iid], "onKOByEffect", { by: controller }, { fromTrash: true }); // M5
        watchers(db, state, "onCharacterKOd", t.owner, t.iid, controller);
        watchers(db, state, "onCharacterRemoved", t.owner, t.iid, controller);
        emit(state, log, { type: "characterKOd", player: t.owner, iid: t.iid, donReturned: given });
      }
      break;

    case "restTarget":
      for (const t of targets) {
        if (!state.players[t.owner].instances[t.iid].rested) {
          emit(state, log, { type: "cardRested", player: t.owner, iid: t.iid });
          becameRested(db, state, t.owner, t.iid, controller);
          watchers(db, state, "onCharacterRestedBy", t.owner, t.iid, controller);
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
        watchers(db, state, "onHandTrashed", t.owner, t.iid, controller, { source: running.sourceIid });
        emit(state, log, { type: "cardsDiscarded", player: t.owner, iids: [t.iid] });
      }
      break;

    case "returnToHand": // bounce (M3)
      for (const t of targets) {
        if (!isOnField(state, t.owner, t.iid)) continue;
        watchers(db, state, "onCharacterRemoved", t.owner, t.iid, controller);
        watchers(db, state, "onCharacterBounced", t.owner, t.iid, controller); // M5
        emit(state, log, { type: "returnedToHand", player: t.owner, iid: t.iid });
      }
      break;

    case "returnToDeck": { // "place at the top/bottom of the owner's deck" (M3; hand / trash M5)
      for (const t of targets) {
        const z = state.players[t.owner].zones;
        const from: "field" | "hand" | "trash" | "deck" | "life" | null = isOnField(state, t.owner, t.iid) ? "field" : z.hand.includes(t.iid) ? "hand"
          : z.trash.includes(t.iid) ? "trash" : z.deck.includes(t.iid) ? "deck" : z.life.includes(t.iid) ? "life" : null;
        if (!from) continue; // left already
        if (from === "field") watchers(db, state, "onCharacterRemoved", t.owner, t.iid, controller);
        const moved = { type: "returnedToDeck" as const, player: t.owner, iid: t.iid, where: action.where, from };
        if (from === "life") emitLife(db, state, log, moved); // M5: "place 1 card from your opponent's Life area at the bottom of the owner's deck"
        else emit(state, log, moved);
      }
      break;
    }

    case "addToLife": { // M5 — from the top of a deck, the field or the hand
      const where = action.bottom ? "bottom" : "top";
      const faceUp = !!action.faceUp;
      if (action.sel.zone === "deckTop" && !action.sel.prev) {
        const pid = action.sel.owner === "opponent" ? opponentOf(state, controller) : controller;
        addDeckTopToLife(state, log, pid, action.sel.count, faceUp, where);
        break;
      }
      for (const t of targets) {
        const z = state.players[t.owner].zones;
        const from = isOnField(state, t.owner, t.iid) ? "field" : z.hand.includes(t.iid) ? "hand" : z.trash.includes(t.iid) ? "trash" : null;
        if (from === "field") watchers(db, state, "onCharacterRemoved", t.owner, t.iid, controller);
        if (from) emit(state, log, { type: "addedToLife", player: t.owner, iid: t.iid, from, faceUp, where });
      }
      break;
    }

    case "restDon": // rest up to N active DON!! of a player (M5)
      for (const pid of whoToPids(state, controller, action.who)) {
        const n = Math.min(action.count, state.players[pid].don.active);
        if (n > 0) emit(state, log, { type: "donRestedByEffect", player: pid, count: n });
      }
      break;

    case "lifeTopToBottom": // M5
      for (const pid of whoToPids(state, controller, action.who)) {
        const life = state.players[pid].zones.life;
        if (life.length > 1) emit(state, log, { type: "lifeTopToBottom", player: pid });
      }
      break;

    case "peekLife": // looking changes nothing (M5): a log line
      for (const pid of whoToPids(state, controller, action.who)) {
        const top = state.players[pid].zones.life.at(-1);
        if (top) emit(state, log, { type: "lifePeeked", player: controller, owner: pid, iid: top });
      }
      break;

    case "scheduleEndOfTurn": // M5: run this card's delayed effect at the end of this turn (6-6-1)
      if (action.aboutPrev && !running.lastTargets[0]) break; // "the Character played by this effect": none was played
      emit(state, log, { type: "endOfTurnScheduled", player: controller, sourceIid: running.sourceIid, sourceCardId: running.sourceCardId, effectIndex: action.effectIndex,
        ...(action.aboutPrev ? { subject: running.lastTargets[0] } : {}) });
      break;

    case "flipLife": // top N Life cards (99 = all) turned face-up / face-down (M5)
      for (const pid of whoToPids(state, controller, action.who)) {
        const p = state.players[pid];
        const n = Math.min(action.count, p.zones.life.length);
        const iids = (action.bottom ? p.zones.life.slice(0, n) : p.zones.life.slice(-n)).filter((iid) => !!p.instances[iid].faceUp !== action.faceUp); // M5: "from the bottom"
        if (iids.length > 0) emit(state, log, { type: "lifeFlipped", player: pid, iids, faceUp: action.faceUp });
      }
      break;

    case "trashTarget": // field → trash: not a K.O., so no [On K.O.] (M5)
      for (const t of targets) {
        if (!isOnField(state, t.owner, t.iid)) continue;
        watchers(db, state, "onCharacterRemoved", t.owner, t.iid, controller);
        emit(state, log, { type: "characterTrashedByRule", player: t.owner, iid: t.iid });
      }
      break;

    case "reveal":
      if (targets.length > 0) emit(state, log, { type: "cardsRevealed", player: targets[0].owner, iids: targets.map((t) => t.iid) });
      break;

    case "giveActiveDon": // one active DON!! at a time (6-5-5)
      for (const t of targets) {
        for (let i = 0; i < action.count && state.players[t.owner].don.active > 0; i++) {
          emit(state, log, { type: "donGiven", player: t.owner, targetIid: t.iid });
        }
      }
      break;

    case "addFromTrashToHand": // (M3)
      for (const t of targets) {
        emit(state, log, { type: "trashToHand", player: t.owner, iid: t.iid });
      }
      break;

    case "giveRestedDon": { // "give N rested DON!! to ..." (M3) — from the cost area of the card's owner (M5)
      for (const t of targets) {
        const n = Math.min(action.count, state.players[t.owner].don.rested); // 8-1-2 as much as possible
        if (n > 0) emit(state, log, { type: "donGivenFromRested", player: t.owner, targetIid: t.iid, count: n });
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
      // "play this card from your trash / hand" (M5)
      if (action.sel.self) {
        const p = state.players[controller];
        const from = action.zone === "trash" ? "trash" : "hand";
        const inst = p.instances[running.sourceIid];
        if (inst && p.zones[from].includes(running.sourceIid) && db(inst.cardId).category === "Character" && p.zones.characterArea.length < 5
          && !playLocked(db, state, controller, running.sourceIid, from === "hand")
          && !hasRestriction(db, state, controller, running.sourceIid, "cannotBePlayedByEffects")) {
          watchers(db, state, "onYouPlayCharacter", controller, running.sourceIid, controller, { fromTrash: from === "trash", source: running.sourceIid });
          emit(state, log, { type: "playedFromZone", player: controller, iid: running.sourceIid, from, rested: action.rested ?? false });
          enqueueAutoEffects(db, state, controller, running.sourceIid, "onPlay");
        }
        break;
      }
      // generic play from hand/trash (M3; free — the effect pays no DON)
      for (const t of targets) {
        const p = state.players[t.owner]; // the card's owner plays it ("your opponent plays …", M5)
        const card = db(state.players[t.owner].instances[t.iid].cardId);
        if (card.category === "Stage") {
          // "play up to 2 … type cards" may play a Stage (M5): 3-8-5-1, the old one is trashed
          const old = state.players[t.owner].zones.stage[0];
          if (old) emit(state, log, { type: "characterTrashedByRule", player: t.owner, iid: old });
          emit(state, log, { type: "playedFromZone", player: t.owner, iid: t.iid, from: action.zone === "trash" ? "trash" : "hand", rested: false, zone: "stage" });
          enqueueAutoEffects(db, state, t.owner, t.iid, "onPlay");
          continue;
        }
        if (p.zones.characterArea.length >= 5) continue; // 3-7-6, no replace for effect plays
        if (card.category !== "Character" || playLocked(db, state, t.owner, t.iid, action.zone === "hand")) continue;
        if (hasRestriction(db, state, t.owner, t.iid, "cannotBePlayedByEffects")) continue; // M5
        watchers(db, state, "onYouPlayCharacter", t.owner, t.iid, controller, { fromTrash: action.zone === "trash", source: running.sourceIid });
        const played = {
          type: "playedFromZone" as const, player: t.owner, iid: t.iid,
          from: action.zone === "trash" ? "trash" as const : action.zone === "life" ? "life" as const : "hand" as const,
          rested: (action.rested ?? false) || hasRestriction(db, state, t.owner, p.leaderIid, "charactersPlayedRested"),
        };
        if (played.from === "life") emitLife(db, state, log, played); // M5: a revealed Life card is played
        else emit(state, log, played);
        // 10-2-6 [On Play] fires for effect plays too
        enqueueAutoEffects(db, state, t.owner, t.iid, "onPlay");
      }
      break;
    }

    case "activateEvent": { // M5 — the chosen Event's [Main] resolves before the rest of this effect
      const t = targets[0];
      if (!t) break;
      const cardId = state.players[t.owner].instances[t.iid].cardId;
      const effects = db(cardId).compiled?.effects ?? [];
      const idx = effects.findIndex((fx) => fx.timing === "main");
      if (idx < 0) break;
      if (!conditionsMet(db, state, controller, t.iid, effects[idx].conditions) || !canPayCost(db, state, controller, t.iid, effects[idx].cost)) break;
      emit(state, log, { type: "eventCardUsed", player: t.owner, iid: t.iid, donRested: 0, baseCost: db(cardId).cost ?? 0,
        ...(state.players[t.owner].zones.hand.includes(t.iid) ? {} : { stays: true }) });
      enqueueEventActivationReactions(db, state, controller);
      state.exec!.suspended = [...(state.exec!.suspended ?? []), running];
      beginEffect(db, state, log, controller, t.iid, cardId, idx);
      break;
    }

    case "peekDeck": // only the opponent's 1-card reveal gets here (planAction)
      for (const pid of whoToPids(state, controller, action.who)) {
        const top = state.players[pid].zones.deck.slice(0, action.count);
        if (top.length > 0) emit(state, log, action.then.reveal ? { type: "cardsRevealed", player: pid, iids: top } : { type: "deckPeeked", player: controller, iids: top });
      }
      break;

    case "nextPlayDiscount": { // M5 — spent by the next matching play from the hand this turn
      const p = state.players[controller];
      emit(state, log, { type: "modifierAdded", modifier: {
        source: running.sourceIid, controller, kind: "playDiscount", targetOwner: controller, targetIid: p.leaderIid,
        amount: action.amount, filter: action.filter, duration: "thisTurn", anchor: controller, createdTurn: state.turn,
      }});
      break;
    }

    case "takeExtraTurn": // "take an extra turn after this one" (M5)
      emit(state, log, { type: "extraTurnGranted", player: controller });
      break;

    case "swapBasePower": { // M5 — each takes the other's base power, as it is now
      const pair = action.withLeader && targets.length === 1 ? [{ owner: controller, iid: state.players[controller].leaderIid }, targets[0]] : targets;
      if (pair.length !== 2) break;
      const [x, y] = pair;
      const bx = effectiveBasePower(db, state, x.owner, x.iid), by = effectiveBasePower(db, state, y.owner, y.iid);
      for (const [t, amount] of [[x, by], [y, bx]] as const) {
        emit(state, log, { type: "modifierAdded", modifier: {
          source: running.sourceIid, controller, kind: "basePower", targetOwner: t.owner, targetIid: t.iid, amount,
          duration: action.duration, anchor: controller, createdTurn: state.turn,
        }});
      }
      break;
    }

    case "moveGivenDon": { // M5 — from the cards chosen before (prevCount sources), one DON!! at a time
      const to = targets[0];
      if (!to) break;
      let left = action.count;
      for (const src of prevSources) {
        if (left <= 0) break;
        if (src.owner !== to.owner || src.iid === to.iid) continue;
        const n = Math.min(left, state.players[src.owner].don.given[src.iid] ?? 0);
        if (n > 0) { emit(state, log, { type: "givenDonMoved", player: src.owner, from: src.iid, to: to.iid, count: n }); left -= n; }
      }
      break;
    }

    case "freezeDon": // M5
      for (const pid of whoToPids(state, controller, action.who)) {
        const n = Math.min(action.count, state.players[pid].don.rested - (state.players[pid].don.frozen ?? 0));
        if (n > 0) emit(state, log, { type: "donFrozen", player: pid, count: n });
      }
      break;

    case "winGame": // "you win the game" (M5)
      emit(state, log, { type: "gameEnded", winner: controller, reason: "effect" });
      break;

    case "shuffleDeck":
      for (const pid of whoToPids(state, controller, action.who)) shuffleDeck(state, log, pid);
      break;

    case "shuffleHandIntoDeck":
      for (const pid of whoToPids(state, controller, action.who)) {
        const hand = [...state.players[pid].zones.hand];
        for (const iid of hand) emit(state, log, { type: "returnedToDeck", player: pid, iid, where: "bottom", from: "hand" });
        shuffleDeck(state, log, pid);
        if (action.redraw && hand.length > 0) effectDraw(db, state, log, pid, hand.length);
      }
      break;

    case "ifThen": {
      // 8-3-3: resolve the branch inline by splicing it into the running
      // actions right after this one (conditions checked now)
      const branch = conditionsMet(db, state, controller, running.sourceIid, action.if, running)
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
  if (hasRestriction(db, state, owner, iid, "cannotBlock") || hasRestriction(db, state, owner, iid, "cannotBeRested")) return false;
  if (hasRestriction(db, state, owner, state.players[owner].leaderIid, "noBlockers")) return false; // M5
  return true;
}
