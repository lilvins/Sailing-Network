/**
 * AUTOSIM battle machine (7-1) + the effect-resolution pump (8-6) — extracted
 * from engine.ts in M1; M3 adds the activation-cost phase (8-3-1, with
 * payment choices), the peek/search window (8-4-4-4), DON!!−X composition
 * (8-3-1-6), "draw up to N", prev-binding ("that card"), and the
 * end-of-turn / end-of-battle enqueue points (6-6-1, 7-1-5-2).
 *
 * The pump is the single scheduler for effect resolution: it pays the running
 * effect's costs item by item, advances it action by action (1-3-7), drains
 * the auto-effect queue with the 8-6 ordering, suspends the queue while
 * damage processing is underway (8-6-2), pauses on ChoiceRequests, and
 * finally resumes the interrupted flow. engine.ts validates intents and
 * delegates here.
 */
import { seededRng, shuffleWith } from "../../lib/rng";
import type { Action, CostItem, Effect } from "../ir/types";
import { emit, type GameEvent } from "./events";
import { EngineError } from "./intents";
import {
  actionCandidates, addDeckTopToLife, applyAction, playCharacterFromZone, becameRested, canPerformFully, donReturned, emitLife, playLocked, watchers, canBlock, canPayCost, conditionsMet, drawCards, effectDraw, isOnField,
  matchesFilter, planAction, resolveSelector, type TargetRef,
} from "./effects";
import {
  attackTargetAllowed, attackTax, attributesOf, baseCostLocked, effectivePower, hasRestriction, isPlayersFirstTurn, keywordsOf, opponentOf,
  type AutoGameState, type CardDb, type FlowResume, type Iid, type PID,
  type QueuedEffect, type RunningEffect,
} from "./state";
import { enqueueAutoEffects, enqueueReactions, ensureExec, nextGeneration, takeNext } from "./triggers";
import { activeModifiers } from "./continuous";
import { findReplacements, removalOf } from "./replacements";

// ─── small helpers ───────────────────────────────────────────────────────────

function effectOf(db: CardDb, cardId: string, effectIndex: number): Effect | null {
  return db(cardId).compiled?.effects[effectIndex] ?? null;
}

/** Deterministic shuffle: derives from seed + per-state use counter; the
 *  resulting order is recorded in the event so replay never needs RNG. */
export function shuffleDeck(state: AutoGameState, log: GameEvent[], player: PID): void {
  const rand = seededRng(`${state.seed}:${state.rngUses++}`);
  const order = shuffleWith(state.players[player].zones.deck, rand);
  emit(state, log, { type: "deckShuffled", player, order });
}

/** All of a player's field cards (leader + characters + stage). */
function fieldIids(state: AutoGameState, pid: PID): Iid[] {
  const p = state.players[pid];
  return [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage];
}

/** 7-1-1-4 / 7-1-2-3 / 7-1-3 end-of-step rule: if the attacker or the target
 *  left their area, the battle skips ahead to End of the Battle. */
function battleIntact(state: AutoGameState): boolean {
  const b = state.battle;
  if (!b) return false;
  const att = state.players[b.attackerOwner];
  const def = state.players[b.defenderOwner];
  return (b.attackerIid === att.leaderIid || att.zones.characterArea.includes(b.attackerIid))
      && (b.targetIid === def.leaderIid || def.zones.characterArea.includes(b.targetIid));
}

/** Head for End of the Battle: queue "at the end of this battle" effects
 *  (7-1-5-2) — the battle itself closes (7-1-5-3/4/5) once they resolve.
 *  Callers outside the pump must pump() afterwards. */
export function endBattle(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  if (!state.battle) return;
  // "at the end of this battle, place this Character at the bottom of the owner's deck" (M5)
  for (const [pid, iid] of [[state.battle.attackerOwner, state.battle.attackerIid], [state.battle.defenderOwner, state.battle.targetIid]] as const) {
    if (state.players[pid].zones.characterArea.includes(iid) && hasRestriction(db, state, pid, iid, "toDeckBottomAtEndOfBattle")) {
      emit(state, log, { type: "returnedToDeck", player: pid, iid, where: "bottom", from: "field" });
    }
  }
  const exec = ensureExec(state, { at: "toBattleCleanup" });
  exec.flow = { at: "toBattleCleanup" };
  // 7-1-5-2: your own and your opponent's end-of-battle effects activate
  for (const pid of [state.turnPlayer, opponentOf(state, state.turnPlayer)]) {
    for (const iid of fieldIids(state, pid)) enqueueAutoEffects(db, state, pid, iid, "endOfBattle");
  }
  // "At the end of a battle in which this Character battles your opponent's Character" (M5)
  const b = state.battle;
  const isChar = (pid: PID, iid: Iid) => state.players[pid].zones.characterArea.includes(iid);
  if (isChar(b.attackerOwner, b.attackerIid) && isChar(b.defenderOwner, b.targetIid)) {
    enqueueAutoEffects(db, state, b.attackerOwner, b.attackerIid, "afterBattleWithCharacter", { subject: { owner: b.defenderOwner, iid: b.targetIid } });
    enqueueAutoEffects(db, state, b.defenderOwner, b.targetIid, "afterBattleWithCharacter", { subject: { owner: b.attackerOwner, iid: b.attackerIid } });
  }
}

// ─── turn start (6-2 … 6-4) — here so the End Phase flow can call it ─────────

export function startTurn(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, turn: number): void {
  emit(state, log, { type: "turnStarted", turn, player });
  // 6-2-1 (M5): "at the start of your / your opponent's turn" effects resolve first
  const opp = opponentOf(state, player);
  for (const iid of fieldIids(state, player)) enqueueAutoEffects(db, state, player, iid, "startOfYourTurn");
  for (const iid of fieldIids(state, opp)) enqueueAutoEffects(db, state, opp, iid, "startOfOpponentsTurn");
  if (state.exec && state.exec.queue.length > 0 && !state.exec.running) {
    state.exec.flow = { at: "toRefresh" };
    return;
  }
  refreshDrawDon(db, state, log, player, turn);
}

/** 6-2-2 … 6-4: Refresh, Draw and DON!! Phases. */
function refreshDrawDon(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, turn: number): void {
  // Refresh Phase (6-2): return given DON rested (6-2-3), then stand all (6-2-4)
  const p = state.players[player];
  const givenTotal = Object.values(p.don.given).reduce((s, n) => s + n, 0);
  if (givenTotal > 0) emit(state, log, { type: "givenDonReturned", player, count: givenTotal });
  // "do not become active in Refresh Phases" (static, M5)
  const keepRested = [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage].filter((iid) => p.instances[iid].rested && hasRestriction(db, state, player, iid, "noRefresh"));
  emit(state, log, { type: "allStood", player, ...(keepRested.length > 0 ? { keepRested } : {}) });

  // Draw Phase (6-3): the first player does not draw on their first turn
  if (!(player === state.order[0] && turn === 1)) {
    drawCards(state, log, player, 1);
    if (state.phase === "over") return; // deck-out during draw
  }

  // DON!! Phase (6-4): 2, or 1 on the first player's first turn; capped by deck
  const wanted = player === state.order[0] && turn === 1 ? 1 : 2;
  const count = Math.min(wanted, p.don.deck); // 6-4-2 / 6-4-3
  if (count > 0) emit(state, log, { type: "donPlaced", player, count });
  // "1 DON!! card placed during your DON!! Phase is given to your Leader" (M5)
  if (count > 0) for (const iid of fieldIids(state, player)) enqueueAutoEffects(db, state, player, iid, "onDonPhase");
  // "your opponent rests 1 of their active DON!! cards at the start of their next Main Phase" (M5)
  const rests = state.modifiers.filter((m) => m.kind === "restriction" && m.restriction === "restDonAtMainStart" && m.targetOwner === player && m.targetIid === p.leaderIid)
    .reduce((s, m) => s + (m.amount ?? 1), 0);
  const n = Math.min(rests, p.don.active);
  if (n > 0) emit(state, log, { type: "donRestedByEffect", player, count: n });
}

// ─── the pump: effect resolution scheduler (8-6) ─────────────────────────────

/** Advance effect resolution until a ChoiceRequest pauses it, the game ends,
 *  or the interrupted flow fully resumes. Pure and synchronous. */
export function pump(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  while (state.phase !== "over") {
    const exec = state.exec;
    if (!exec) return;

    // 1 — an effect is mid-resolution
    if (exec.running) {
      const r = exec.running;
      // 1a — activation-cost phase (8-3-1-1: items in written order)
      if (r.costIndex < r.costs.length) {
        if (payNextCost(db, state, log)) return; // paused on a payment choice
        continue;
      }
      // 1b′ — a removal waiting on replacement decisions (M5, 8-1-3-4)
      if (r.guard) {
        if (applyGuarded(db, state, log, r, r.guard.action, r.guard.targets)) return;
        r.actionIndex += 1;
        continue;
      }
      // 1b″ — a Character waiting for room in a full area (3-7-6-1)
      if (r.awaitingRoom?.length) {
        const next = r.awaitingRoom[0];
        const area = state.players[next.target.owner].zones.characterArea;
        if (area.length < 5) {
          r.awaitingRoom.shift();
          playCharacterFromZone(db, state, log, r.controller, r, next.action, next.target);
          continue;
        }
        state.pendingChoice = {
          kind: "selectTargets", player: next.target.owner, sourceIid: r.sourceIid, actionKind: "trashTarget",
          candidates: area.map((iid) => ({ owner: next.target.owner, iid })), count: 1, upTo: false,
        };
        return;
      }
      // 1b — actions (1-3-7 written order)
      if (r.actionIndex >= r.actions.length) {
        // effect done — a [Trigger] card is trashed unless an action moved it (10-1-5-3)
        if (r.triggerCard && !r.triggerCard.moved) {
          emit(state, log, { type: "triggerCardTrashed", player: r.controller, iid: r.triggerCard.iid });
        }
        // a replacement effect ends → the effect it interrupted goes on (M5)
        exec.running = exec.suspended?.length ? exec.suspended.pop()! : null;
        continue;
      }
      const action = r.actions[r.actionIndex];
      const plan = planAction(db, state, r.controller, r, action);
      if (plan.kind === "manual") {
        // plan §1.3 graceful degradation: resolve manually, then acknowledge
        state.pendingChoice = { kind: "manualResolve", player: r.controller, sourceIid: r.sourceIid, text: plan.text };
        return;
      }
      if (plan.kind === "choose") {
        // 8-4-4: the indicated player chooses when required during resolution
        state.pendingChoice = {
          kind: "selectTargets", player: plan.chooser, sourceIid: r.sourceIid,
          actionKind: action.kind, candidates: plan.candidates, count: plan.count, upTo: plan.upTo,
          ...(plan.set ?? {}),
        };
        return;
      }
      if (plan.kind === "peek") {
        if (openPeek(db, state, log)) return; // peekSelect pending
        continue;
      }
      if (plan.kind === "chooseOption") {
        // "Choose one:" (M5) — every option may be chosen, even one that
        // would do nothing now (8-1-2: do as much as possible)
        const choosing = action.kind === "chooseOne" && action.chooser === "opponent" ? opponentOf(state, r.controller) : r.controller;
        const enabled = plan.labels.map((_, i) => action.kind !== "chooseOne" || !action.payable?.[i]
          || (action.options[i].length > 0 && canPerformFully(db, state, r.controller, r.sourceIid, action.options[i][0])));
        if (enabled.filter(Boolean).length === 1 && action.kind === "chooseOne" && action.payable) {
          // "If they do not, …": the payment can't be made — the other option happens
          r.actions.splice(r.actionIndex + 1, 0, ...action.options[enabled.indexOf(true)]);
          r.actionIndex += 1;
          continue;
        }
        state.pendingChoice = {
          kind: "chooseOption", player: choosing, sourceIid: r.sourceIid,
          options: plan.labels, enabled, purpose: "effect",
        };
        return;
      }
      if (plan.kind === "damage") {
        if (effectDamage(db, state, log, r, action as Extract<Action, { kind: "dealDamage" }>)) return; // a [Trigger] decision, or the game ended
        r.actionIndex += 1;
        continue;
      }
      if (plan.kind === "arrangeLife") {
        state.pendingChoice = {
          kind: "arrangeLife", player: r.controller, sourceIid: r.sourceIid, lifeOwner: plan.owner,
          cards: [...state.players[plan.owner].zones.life].reverse(), toDeckTop: plan.toDeckTop,
        };
        return;
      }
      if (plan.kind === "chooseNumber") {
        // "draw up to N" — 8-4-4-1: 'up to' allows 0
        state.pendingChoice = { kind: "chooseNumber", player: r.controller, sourceIid: r.sourceIid, min: 0, max: plan.max, purpose: plan.purpose ?? "draw" };
        return;
      }
      if (applyGuarded(db, state, log, r, action, plan.targets)) return; // paused on a replacement choice
      r.actionIndex += 1;
      continue;
    }

    // 2 — damage processing in progress: it takes priority; queued effects
    //     wait until all damage is resolved (8-6-2)
    if (exec.flow.at === "damage") {
      const remaining = exec.flow.remaining;
      exec.flow = { at: "toEndBattle" }; // once damage is done: drain queue, then 7-1-5
      const paused = processDamage(db, state, log, remaining);
      if (paused) return; // triggerDecision pending (8-6-2-1)
      continue;
    }

    // 3 — pull the next queued auto effect (8-6-1 ordering)
    const q = takeNext(state);
    if (q) {
      const fx = effectOf(db, q.sourceCardId, q.effectIndex);
      if (!fx) continue;
      // 8-1-3-1-3: no activation if the source left its area first —
      // except [On K.O.], which resolves from the trash (10-2-17-2)
      if (q.anyZone) {
        // scheduled effects (M5): their actions check their own targets
      } else if (q.fromTrash) {
        if (!state.players[q.controller].zones.trash.includes(q.sourceIid)) continue;
      } else if (!isOnField(state, q.controller, q.sourceIid)) continue;
      // the event's subject is "that Character" for the activation conditions too (M5)
      const asRunning = q.subject ? ({ lastTargets: [q.subject] } as unknown as RunningEffect) : undefined;
      if (!conditionsMet(db, state, q.controller, q.sourceIid, fx.conditions, asRunning)) continue; // 8-4-1-1
      if (fx.oncePerTurn && state.oncePerTurnUsed[`${q.controller}:${q.sourceIid}:${q.effectIndex}`] === state.turn) continue; // 10-2-13-3
      if (!canPayCost(db, state, q.controller, q.sourceIid, fx.cost)) continue; // 8-3-1-3
      if (fx.optional) {
        // 8-1-2 "may": ask before activating
        exec.pendingMay = q;
        state.pendingChoice = {
          kind: "mayActivate", player: q.controller, sourceIid: q.sourceIid,
          sourceCardId: q.sourceCardId, effectIndex: q.effectIndex,
        };
        return;
      }
      startEffect(db, state, log, q);
      continue;
    }

    // 4 — queue drained: resume the interrupted flow
    const flow = exec.flow;
    state.exec = null;
    resumeFlow(db, state, log, flow);
    if (!state.exec) return; // flow fully resolved (window opened / battle over / main)
  }
}

/** Begin resolving an effect: log the activation FIRST (10-2-13-5: a [Once
 *  Per Turn] counts as used the moment it is activated, even if the payment
 *  later fizzles), then pay costs and run actions via the pump. */
export function beginEffect(
  db: CardDb, state: AutoGameState, log: GameEvent[],
  controller: PID, sourceIid: Iid, sourceCardId: string, effectIndex: number,
  opts?: { triggerCard?: { iid: Iid; moved: boolean } },
): void {
  const fx = effectOf(db, sourceCardId, effectIndex)!;
  nextGeneration(state); // effects fulfilled from now on resolve later (8-6-1-1)
  emit(state, log, {
    type: "effectActivated", player: controller, sourceIid,
    sourceCardId, effectIndex, timing: fx.timing, oncePerTurn: !!fx.oncePerTurn,
  });
  const running: RunningEffect = {
    controller, sourceIid, sourceCardId, effectIndex,
    costs: fx.cost ? [...fx.cost] : [], costIndex: 0,
    actions: [...fx.actions], actionIndex: 0,
    lastTargets: [],
  };
  if (opts?.triggerCard) running.triggerCard = opts.triggerCard;
  state.exec!.running = running;
}

function startEffect(db: CardDb, state: AutoGameState, log: GameEvent[], q: QueuedEffect): void {
  beginEffect(db, state, log, q.controller, q.sourceIid, q.sourceCardId, q.effectIndex);
  if (q.subject) state.exec!.running!.lastTargets = [q.subject]; // "that Character" (M5)
}

// ─── cost payment (8-3-1) ────────────────────────────────────────────────────

const COST_ACTION_KIND: Record<string, Action["kind"]> = {
  trashFromHand: "discard",        // 10-2-14
  returnToHand: "returnToHand",
  restFromField: "restTarget",
  handToDeckBottom: "returnToDeck",
};

/** Pay cost items in order until done or a choice pauses payment. Returns
 *  true when paused (pendingChoice set). */
function payNextCost(db: CardDb, state: AutoGameState, log: GameEvent[], ): boolean {
  const exec = state.exec!;
  const r = exec.running!;
  while (r.costIndex < r.costs.length) {
    const item = r.costs[r.costIndex];
    const p = state.players[r.controller];
    switch (item.kind) {
      case "restDon": // ① (8-3-1-5)
        emit(state, log, { type: "costPaid", player: r.controller, restDon: item.count, returnDon: 0 });
        r.costIndex += 1;
        continue;

      case "restSelf":
        if (!p.instances[r.sourceIid].rested) {
          emit(state, log, { type: "cardRested", player: r.controller, iid: r.sourceIid });
          becameRested(db, state, r.controller, r.sourceIid, r.controller);
        }
        r.costIndex += 1;
        continue;

      case "trashSelf": // trash this card as a cost (2-7, same movement as the rule trash)
        emit(state, log, { type: "characterTrashedByRule", player: r.controller, iid: r.sourceIid });
        r.costIndex += 1;
        continue;

      case "trashFromLife": { // top Life card(s) → trash (3-10 ordering)
        for (let i = 0; i < item.count && p.zones.life.length > 0; i++) {
          emitLife(db, state, log, { type: "lifeCardTrashed", player: r.controller, iid: item.bottom ? p.zones.life[0] : p.zones.life[p.zones.life.length - 1] });
        }
        r.costIndex += 1;
        continue;
      }

      case "lifeToHand": { // "add N from your Life to your hand:" (M3) — top cards
        for (let i = 0; i < item.count && p.zones.life.length > 0; i++) {
          emitLife(db, state, log, { type: "lifeCardToHand", player: r.controller, iid: item.bottom ? p.zones.life[0] : p.zones.life[p.zones.life.length - 1] });
        }
        r.costIndex += 1;
        continue;
      }

      case "returnDonToDeck": { // DON!!−X (8-3-1-6)
        const given = Object.values(p.don.given).reduce((s, n) => s + n, 0);
        if (given === 0 && (p.don.active === 0 || p.don.rested === 0)) {
          // one kind of DON!! on the field: nothing to choose, pay it
          const fromRested = Math.min(item.count, p.don.rested);
          const fromActive = item.count - fromRested;
          emit(state, log, { type: "donPaid", player: r.controller, fromActive, fromRested, fromGiven: {} });
          donReturned(db, state, r.controller, item.count, r.controller);
          r.costIndex += 1;
          continue;
        }
        // active AND rested (or attached) DON!!: which ones go back is the
        // player's call (8-3-1-6) — keeping an active one may pay a later cost
        state.pendingChoice = { kind: "payDon", player: r.controller, sourceIid: r.sourceIid, amount: item.count };
        return true;
      }

      case "trashFromHand":
      case "returnToHand":
      case "restFromField": {
        const sel = item.sel;
        const candidates = resolveSelector(db, state, r.controller, r.sourceIid, sel);
        if (candidates.length <= sel.count) {
          applyCostTargets(db, state, log, r, item, candidates.slice(0, sel.count));
          r.costIndex += 1;
          continue;
        }
        const chooser = sel.chooser === "opponent" ? opponentOf(state, r.controller) : r.controller;
        state.pendingChoice = {
          kind: "selectTargets", player: chooser, sourceIid: r.sourceIid,
          actionKind: COST_ACTION_KIND[item.kind], candidates, count: sel.count, upTo: false,
        };
        return true;
      }

      case "oneOf": { // "X or Y:" (M5) — the payer picks a payable option
        const rest = r.costs.slice(r.costIndex + 1);
        const enabled = item.options.map((opt) => canPayCost(db, state, r.controller, r.sourceIid, [...opt, ...rest]));
        if (!enabled.some(Boolean)) { // nothing payable any more (8-3-1-3): the effect does nothing
          r.costIndex = r.costs.length;
          r.actions = [];
          return false;
        }
        if (enabled.filter(Boolean).length === 1) {
          r.costs.splice(r.costIndex, 1, ...item.options[enabled.indexOf(true)]);
          continue;
        }
        state.pendingChoice = {
          kind: "chooseOption", player: r.controller, sourceIid: r.sourceIid,
          options: item.options.map((_, i) => item.labels?.[i] ?? `Option ${i + 1}`), enabled, purpose: "cost",
        };
        return true;
      }

      case "action": { // any other cost, paid by doing the action in full (M5)
        if (payActionCost(db, state, log, r, item.action)) return true;
        r.costIndex += 1;
        continue;
      }

      case "handToDeckBottom": { // "place N from your hand at the bottom of your deck:" (M3)
        const candidates: TargetRef[] = p.zones.hand.map((iid) => ({ owner: r.controller, iid }));
        if (candidates.length <= item.count) {
          applyCostTargets(db, state, log, r, item, candidates);
          r.costIndex += 1;
          continue;
        }
        state.pendingChoice = {
          kind: "selectTargets", player: r.controller, sourceIid: r.sourceIid,
          actionKind: COST_ACTION_KIND[item.kind], candidates, count: item.count, upTo: false,
        };
        return true;
      }
    }
  }
  return false;
}

/** Pay an `action` cost item: perform it now, or pause on the target choice
 *  (every target required — costs are never "up to"). True when paused. */
function payActionCost(db: CardDb, state: AutoGameState, log: GameEvent[], r: RunningEffect, action: Action): boolean {
  if (!("sel" in action) || action.sel.self || action.sel.prev) {
    const plan = planAction(db, state, r.controller, r, action);
    applyAction(db, state, log, r.controller, r, action, plan.kind === "apply" ? plan.targets : []);
    return false;
  }
  let candidates = actionCandidates(db, state, r.controller, r.sourceIid, action);
  if (action.kind === "restTarget") candidates = candidates.filter((t) => !state.players[t.owner].instances[t.iid].rested);
  if (candidates.length <= action.sel.count) {
    applyAction(db, state, log, r.controller, r, action, candidates);
    return false;
  }
  const chooser = action.sel.chooser === "opponent" ? opponentOf(state, r.controller) : r.controller;
  state.pendingChoice = {
    kind: "selectTargets", player: chooser, sourceIid: r.sourceIid,
    actionKind: action.kind, candidates, count: action.sel.count, upTo: false,
  };
  return true;
}

/** Apply a card-choice cost item with its chosen targets. */
function applyCostTargets(
  db: CardDb, state: AutoGameState, log: GameEvent[], r: RunningEffect, item: CostItem, targets: TargetRef[],
): void {
  switch (item.kind) {
    case "trashFromHand":
      if (targets.length > 0) {
        for (const t of targets) watchers(db, state, "onHandTrashed", t.owner, t.iid, r.controller, { source: r.sourceIid });
        emit(state, log, { type: "cardsDiscarded", player: r.controller, iids: targets.map((t) => t.iid) });
      }
      break;
    case "returnToHand":
      for (const t of targets) emit(state, log, { type: "returnedToHand", player: t.owner, iid: t.iid });
      break;
    case "restFromField":
      for (const t of targets) {
        if (!state.players[t.owner].instances[t.iid].rested) {
          emit(state, log, { type: "cardRested", player: t.owner, iid: t.iid });
          becameRested(db, state, t.owner, t.iid, r.controller);
        }
      }
      break;
    case "handToDeckBottom":
      for (const t of targets) {
        emit(state, log, { type: "returnedToDeck", player: t.owner, iid: t.iid, where: "bottom", from: "hand" });
      }
      break;
    default:
      break;
  }
}

// ─── peek/search window (8-4-4-4, 11-2-1) ────────────────────────────────────

/** Start resolving the current peekDeck action. Returns true when paused on a
 *  peekSelect choice; auto-resolves when there is nothing to decide. */
function openPeek(db: CardDb, state: AutoGameState, log: GameEvent[]): boolean {
  const exec = state.exec!;
  const r = exec.running!;
  const action = r.actions[r.actionIndex] as Extract<Action, { kind: "peekDeck" }>;
  const p = state.players[r.controller];
  const cards = p.zones.deck.slice(0, Math.min(action.count, p.zones.deck.length));
  if (cards.length === 0) {
    r.actionIndex += 1;
    return false;
  }
  emit(state, log, { type: "deckPeeked", player: r.controller, iids: cards }); // 11-3-2
  const then = action.then;
  const mode = peekMode(then);
  const filter = then.addToHand ?? then.play ?? then.toLife ?? then.trash;
  let takeCount = mode === "hand" ? (then.addCount ?? 1) : mode === "play" ? (then.playCount ?? 1) : mode === "life" ? (then.lifeCount ?? 1)
    : mode === "trash" ? (then.trashCount ?? 1) : 0;
  if (mode === "play") {
    takeCount = Math.min(takeCount, 5 - p.zones.characterArea.length); // 3-7-6
  }
  const eligible = mode === "none" || takeCount <= 0
    ? []
    : cards.filter((iid) => matchesFilter(db, state, r.controller, iid, filter, r.sourceIid, false)
      && !(mode === "play" && (playLocked(db, state, r.controller, iid) || hasRestriction(db, state, r.controller, iid, "cannotBePlayedByEffects"))));

  // nothing to take AND no ordering to decide → resolve on the spot
  if (eligible.length === 0 && (then.rest === "shuffle" || then.rest === "trash")) {
    resolvePeekWith(db, state, log, [], [], []);
    return false;
  }
  state.pendingChoice = {
    kind: "peekSelect", player: r.controller, sourceIid: r.sourceIid,
    cards, eligible, takeCount: Math.max(0, takeCount), mode,
    rest: then.rest, playRested: !!then.playRested,
  };
  return true;
}

function peekMode(then: Extract<Action, { kind: "peekDeck" }>["then"]): "hand" | "play" | "life" | "trash" | "none" {
  return then.addToHand ? "hand" : then.play ? "play" : then.toLife ? "life" : then.trash ? "trash" : "none";
}

/** Apply a peek resolution (already validated by engine.ts) and advance. */
export function resolvePeekWith(
  db: CardDb, state: AutoGameState, log: GameEvent[],
  take: Iid[], restTop: Iid[], restBottom: Iid[],
): void {
  const exec = state.exec!;
  const r = exec.running!;
  const action = r.actions[r.actionIndex] as Extract<Action, { kind: "peekDeck" }>;
  const then = action.then;
  const p = state.players[r.controller];
  const peeked = p.zones.deck.slice(0, Math.min(action.count, p.zones.deck.length));
  const taken = new Set(take);
  const remaining = peeked.filter((iid) => !taken.has(iid));
  const mode = peekMode(then);
  if (mode === "life") {
    // to the top of the Life, in the chosen order (M5)
    for (const iid of take) emit(state, log, { type: "addedToLife", player: r.controller, iid, from: "deck", faceUp: !!then.lifeFaceUp, where: "top" });
  }

  let top: Iid[] = [];
  let bottom: Iid[] = [];
  let trashed: Iid[] = [];
  switch (then.rest) {
    case "topAnyOrder": top = restTop.length ? restTop : remaining; break;
    case "bottomAnyOrder": bottom = restBottom.length ? restBottom : remaining; break;
    case "topOrBottomAnyOrder": top = restTop; bottom = restBottom; break;
    case "trash": trashed = remaining; break;
    case "shuffle": top = remaining; break; // back on top, then shuffled below
  }
  if (mode === "trash") trashed = [...take, ...trashed]; // "trash up to N cards" (M5)
  emit(state, log, {
    type: "peekResolved", player: r.controller,
    toHand: mode === "hand" ? take : [],
    played: mode === "play" ? take.map((iid) => ({ iid, rested: !!then.playRested })) : [],
    top, bottom, trashed,
  });
  if (mode === "play") {
    // 10-2-6: [On Play] timings fulfilled by effect plays too
    for (const iid of take) watchers(db, state, "onYouPlayCharacter", r.controller, iid, r.controller, { source: r.sourceIid }); // M5
    for (const iid of take) enqueueAutoEffects(db, state, r.controller, iid, "onPlay");
    r.lastTargets = take.map((iid) => ({ owner: r.controller, iid })); // "that Character gains [Rush]" (M5)
  }
  if (then.rest === "shuffle") shuffleDeck(state, log, r.controller);
  r.actionIndex += 1;
}

// ─── flow resumption ─────────────────────────────────────────────────────────

function resumeFlow(db: CardDb, state: AutoGameState, log: GameEvent[], flow: FlowResume): void {
  switch (flow.at) {
    case "none":
      return; // main-phase effect finished — back to the main action window

    case "toBlockStep": {
      if (!state.battle) return;
      emit(state, log, { type: "attackStepEnded" });
      // 7-1-1-4: a participant left during the Attack Step → End of the Battle
      if (!battleIntact(state)) { endBattle(db, state, log); return; }
      openBlockStep(db, state, log);
      return;
    }

    case "toCounterWindow": {
      if (!state.battle) return;
      // 7-1-2-3 (and its Counter Step copy): participant left → End of Battle
      if (!battleIntact(state)) { endBattle(db, state, log); return; }
      openCounterWindow(state);
      return;
    }

    case "toEndBattle":
      // post-damage effects drained (8-6-2) → 7-1-5-2 end-of-battle effects
      if (state.battle) endBattle(db, state, log);
      return;

    case "toBattleCleanup":
      // 7-1-5-3/4 (thisBattle expiry in the reducer) and 7-1-5-5
      if (state.battle) emit(state, log, { type: "battleEnded" });
      return;

    case "toRefresh": // M5: the start-of-turn effects resolved
      refreshDrawDon(db, state, log, state.turnPlayer, state.turn);
      return;

    case "toEndTurn": {
      // End Phase effects resolved (6-6-1-1/2) → durations expire in the
      // turnEnded reducer (6-6-1-3/4), then the next turn starts
      const player = state.turnPlayer;
      // "You lose at the end of the turn in which your deck becomes 0 cards" (Leader rule, M5)
      const out = state.order.find((pid) => state.players[pid].deckOutAtEnd && state.players[pid].zones.deck.length === 0);
      if (out) { emit(state, log, { type: "gameEnded", winner: opponentOf(state, out), reason: "deckOut" }); return; }
      emit(state, log, { type: "turnEnded", turn: state.turn, player });
      startTurn(db, state, log, state.extraTurn === player ? player : opponentOf(state, player), state.turn + 1); // M5: an extra turn
      return;
    }

    case "damage":
      // handled inline by the pump (step 2) — unreachable here
      return;
  }
}

// ─── attack & block (7-1-1, 7-1-2) ───────────────────────────────────────────

export function declareAttack(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, attackerIid: Iid, targetIid: Iid): void {
  const p = state.players[player];
  const oppId = opponentOf(state, player);
  const opp = state.players[oppId];

  // 6-5-6-1: neither player can battle on their first turn
  if (isPlayersFirstTurn(state, player)) throw new EngineError("cannot battle on your first turn (6-5-6-1)");

  // 7-1-1-1: attacker = your active Leader or active Character
  const isLeader = attackerIid === p.leaderIid;
  const isChar = p.zones.characterArea.includes(attackerIid);
  if (!isLeader && !isChar) throw new EngineError("attacker must be your Leader or a Character");
  const attacker = p.instances[attackerIid];
  if (attacker.rested) throw new EngineError("attacker is rested");
  if (hasRestriction(db, state, player, attackerIid, "cannotAttack") || hasRestriction(db, state, player, attackerIid, "cannotBeRested")) {
    throw new EngineError("this card cannot attack (effect restriction)");
  }

  // 7-1-1-2: target = opponent's Leader, or one of their RESTED characters —
  // unless an effect grants "can also attack active Characters" (M3)
  const targetIsLeader = targetIid === opp.leaderIid;
  const targetIsChar = opp.zones.characterArea.includes(targetIid);
  if (!targetIsLeader && !targetIsChar) throw new EngineError("target must be the opponent's Leader or Character");
  if (!attackTargetAllowed(db, state, oppId, targetIid)) throw new EngineError("this card cannot be attacked now (effect)");
  if (baseCostLocked(db, state, player, attackerIid, oppId, targetIid)) throw new EngineError("this card cannot attack that Character (effect)");
  if (attackTax(db, state, player, attackerIid) > state.players[player].zones.hand.length) throw new EngineError("not enough cards in hand to attack (effect)");
  if (targetIsLeader && hasRestriction(db, state, player, state.players[player].leaderIid, "noLeaderAttacks")) throw new EngineError("you cannot attack a Leader this turn (effect)");
  if (targetIsLeader && hasRestriction(db, state, player, attackerIid, "cannotAttackLeaders")) throw new EngineError("this card cannot attack a Leader (effect)");
  if (targetIsChar && !opp.instances[targetIid].rested
      && !hasRestriction(db, state, player, attackerIid, "canAttackActiveCharacters")) {
    throw new EngineError("only RESTED characters can be attacked (7-1-1-2)");
  }

  // 3-7-4 summoning sickness, lifted by the keyword effects:
  // [Rush] → may attack the turn it was played (10-1-1-1);
  // [Rush: Character] → only the opponent's Characters that turn (10-1-6-1).
  if (isChar && attacker.playedOnTurn === state.turn) {
    const kws = keywordsOf(db, state, player, attackerIid);
    if (kws.has("Rush")) {
      // ok (10-1-1-1)
    } else if (kws.has("RushCharacter")) {
      if (targetIsLeader) throw new EngineError("[Rush: Character] can only attack Characters this turn (10-1-6-1)");
    } else {
      throw new EngineError("character was played this turn (3-7-4)");
    }
  }

  emit(state, log, { type: "attackDeclared", attackerOwner: player, attackerIid, defenderOwner: oppId, targetIid });

  // 7-1-1-3: [When Attacking] (turn player) and [On Your Opponent's Attack]
  // (defender) activate — same fulfillment, turn player resolves first
  // (8-6-1, 10-2-16-1). Queue them and pump.
  ensureExec(state, { at: "toBlockStep" });
  // "none of the selected Characters can attack unless your opponent trashes 2 cards from their hand whenever they attack" (M5)
  const tax = activeModifiers(db, state).find((m) => m.kind === "restriction" && m.restriction === "attackTaxDiscard" && m.targetOwner === player && m.targetIid === attackerIid);
  if (tax) {
    const srcOwner = state.order.find((pid) => !!state.players[pid].instances[tax.source]) ?? player;
    state.exec!.running = {
      controller: player, sourceIid: tax.source, sourceCardId: state.players[srcOwner].instances[tax.source].cardId, effectIndex: -1,
      costs: [], costIndex: 0, lastTargets: [], actionIndex: 0,
      actions: [{ kind: "discard", who: "self", sel: { owner: "self", zone: "hand", count: tax.amount ?? 2, chooser: "controller" } }],
    };
  }
  enqueueAutoEffects(db, state, player, attackerIid, "whenAttacking");
  battlesCharacter(db, state, player, attackerIid, oppId, targetIid); // M5
  for (const iid of fieldIids(state, oppId)) {
    enqueueAutoEffects(db, state, oppId, iid, "onYourOpponentsAttack", { subject: { owner: player, iid: attackerIid } });
  }
  // "When your Leader attacks / is attacked" (M5)
  if (attackerIid === state.players[player].leaderIid) {
    for (const iid of fieldIids(state, player)) enqueueAutoEffects(db, state, player, iid, "onLeaderAttacks");
  }
  if (targetIid === state.players[oppId].leaderIid) {
    for (const iid of fieldIids(state, oppId)) enqueueAutoEffects(db, state, oppId, iid, "onLeaderAttacked");
  }
  enqueueAutoEffects(db, state, oppId, targetIid, "whenAttacked"); // "when this card is attacked" (M5)
  becameRested(db, state, player, attackerIid, undefined);           // attacking rests it (7-1-1-1)
  pump(db, state, log);
}

function openBlockStep(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  const battle = state.battle!;
  const defId = battle.defenderOwner;
  const def = state.players[defId];
  // 10-1-7-1 [Unblockable]: the opponent cannot activate [Blocker] at all
  const unblockable = keywordsOf(db, state, battle.attackerOwner, battle.attackerIid).has("Unblockable");
  // 10-1-4-1: active cards with [Blocker], OTHER than the one being attacked,
  // minus cannotBlock restrictions (effects.canBlock). 7-1-2-1: once per battle
  // is structural — the window opens a single time.
  const blockers = unblockable || battle.blockerUsed
    ? []
    : def.zones.characterArea.filter((iid) => iid !== battle.targetIid && canBlock(db, state, defId, iid));
  if (blockers.length > 0) {
    state.pendingChoice = { kind: "blockWindow", player: defId, blockers };
  } else {
    emit(state, log, { type: "blockWindowResolved", blockerIid: null });
    afterBlockResolved(db, state, null);
  }
}

/** After the block decision: queue the blocker's [On Block] effects (7-1-2-2,
 *  10-2-15) and head for the Counter Step. Caller pumps if outside the pump. */
export function afterBlockResolved(db: CardDb, state: AutoGameState, blockerIid: Iid | null): void {
  ensureExec(state, { at: "toCounterWindow" });
  state.exec!.flow = { at: "toCounterWindow" };
  if (blockerIid && state.battle) {
    enqueueAutoEffects(db, state, state.battle.defenderOwner, blockerIid, "onBlock");
    // "When your opponent activates [Blocker]" (M5)
    for (const iid of fieldIids(state, state.battle.attackerOwner)) enqueueAutoEffects(db, state, state.battle.attackerOwner, iid, "onOpponentBlocks");
    becameRested(db, state, state.battle.defenderOwner, blockerIid, undefined); // blocking rests it (10-1-4-1)
    battlesCharacter(db, state, state.battle.attackerOwner, state.battle.attackerIid, state.battle.defenderOwner, blockerIid); // M5
  }
}

/** "When this Character battles <Strike> attribute Characters" (M5): two
 *  Characters meet in a battle (attack on a Character, or a Character blocks);
 *  "that Character" = the other one. */
function battlesCharacter(db: CardDb, state: AutoGameState, a: PID, aIid: Iid, d: PID, dIid: Iid): void {
  const isChar = (pid: PID, iid: Iid) => state.players[pid].zones.characterArea.includes(iid);
  if (!isChar(a, aIid) || !isChar(d, dIid)) return;
  enqueueAutoEffects(db, state, a, aIid, "onBattlesCharacter", { subject: { owner: d, iid: dIid } });
  enqueueAutoEffects(db, state, d, dIid, "onBattlesCharacter", { subject: { owner: a, iid: aIid } });
}

export function openCounterWindow(state: AutoGameState): void {
  if (!state.battle) return;
  // 7-1-3: the attacked player acts; the engine always opens the window —
  // the defender passes if they have nothing (UI can auto-pass).
  state.pendingChoice = { kind: "counterWindow", player: state.battle.defenderOwner };
}

// ─── counter step (7-1-3) ────────────────────────────────────────────────────

/** 7-1-3-2-2: pay the cost of an Event card with [Counter], trash it, and
 *  activate the [Counter] effect. Validation already done by engine.ts. */
export function useCounterEventCard(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, cardIid: Iid, donRested: number): void {
  const p = state.players[player];
  const cardId = p.instances[cardIid].cardId;
  const card = db(cardId);
  const effectIndex = card.compiled!.effects.findIndex((fx) => fx.timing === "counter");

  state.pendingChoice = null;
  emit(state, log, { type: "eventCardUsed", player, iid: cardIid, donRested, baseCost: card.cost ?? 0 });
  ensureExec(state, { at: "toCounterWindow" });
  // "when you/your opponent activates an Event" reactions (8-5-2, M3) —
  // fulfilled by the card activation, resolved after its effect (8.6.3)
  enqueueEventActivationReactions(db, state, player);
  beginEffect(db, state, log, player, cardIid, cardId, effectIndex);
  pump(db, state, log);
}

/** Queue "when you activate an Event" (controller side) and "when your
 *  opponent activates an Event" (other side) timings (M3). */
export function enqueueEventActivationReactions(db: CardDb, state: AutoGameState, activator: PID): void {
  for (const iid of fieldIids(state, activator)) {
    enqueueAutoEffects(db, state, activator, iid, "onYouActivateEvent");
  }
  const other = opponentOf(state, activator);
  for (const iid of fieldIids(state, other)) {
    enqueueAutoEffects(db, state, other, iid, "onOpponentActivatesEvent");
  }
}

// ─── damage step (7-1-4) ─────────────────────────────────────────────────────

/** Entered from passCounter (counterWindowClosed already emitted). */
export function startDamageStep(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  // Counter Step end rule (numbered 7-1-2-3 in the text): participant left → 7-1-5
  if (!battleIntact(state)) { endBattle(db, state, log); pump(db, state, log); return; }
  const battle = state.battle!;
  const def = state.players[battle.defenderOwner];
  const attPower = effectivePower(db, state, battle.attackerOwner, battle.attackerIid);
  const defPower = effectivePower(db, state, battle.defenderOwner, battle.targetIid);
  const targetIsLeader = battle.targetIid === def.leaderIid;

  // 7-1-4-2: attacker's power is less → the battle is lost, nothing happens
  if (attPower < defPower) {
    emit(state, log, { type: "battleLost", attackerIid: battle.attackerIid, targetIid: battle.targetIid });
    endBattle(db, state, log);
    pump(db, state, log);
    return;
  }

  // 7-1-4-1: greater or equal → the battle is won
  emit(state, log, { type: "battleWon", attackerIid: battle.attackerIid, targetIid: battle.targetIid });
  if (targetIsLeader) {
    // 7-1-4-1-1: damage to the Leader — 2 with [Double Attack] (10-1-2-1,
    // 7-1-4-1-1-3), processed one Life card at a time.
    const damage = keywordsOf(db, state, battle.attackerOwner, battle.attackerIid).has("DoubleAttack") ? 2 : 1;
    const exec = ensureExec(state, { at: "damage", remaining: damage });
    exec.flow = { at: "damage", remaining: damage };
    pump(db, state, log);
  } else if (hasRestriction(db, state, battle.defenderOwner, battle.targetIid, "cannotBeKOd")
          || battleImmune(db, state, battle)) {
    // 10-2-1-3: the Character is not K.O.'d by the battle — nothing happens
    endBattle(db, state, log);
    pump(db, state, log);
  } else {
    battleKO(db, state, log);
  }
}

/** 7-1-4-1-2: the attacked Character is K.O.'d — unless its owner uses a
 *  replacement ("if this Character would be K.O.'d, you may … instead",
 *  8-1-3-4, M5). Re-entered after each declined replacement. */
function battleKO(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  const battle = state.battle!;
  const def = state.players[battle.defenderOwner];
  const reps = findReplacements(db, state, battle.defenderOwner, battle.targetIid, "koBattle", undefined, battle.koDeclined ?? []);
  if (reps.length > 0) {
    state.pendingChoice = { kind: "mayReplace", player: battle.defenderOwner, sourceIid: reps[0].sourceIid, effectIndex: reps[0].effectIndex, targetIid: battle.targetIid, battle: true };
    return;
  }
  {
    // 7-1-4-1-2: the Character is K.O.'d. Its [On K.O.] timing is fulfilled on
    // the field (10-2-17-1) and resolves after damage processing (8-6-2).
    ensureExec(state, { at: "toEndBattle" });
    enqueueAutoEffects(db, state, battle.defenderOwner, battle.targetIid, "onKO", { fromTrash: true });
    enqueueKOdReactionsLocal(db, state, battle.defenderOwner);
    const given = def.don.given[battle.targetIid] ?? 0;
    watchers(db, state, "onCharacterKOd", battle.defenderOwner, battle.targetIid, undefined);
    emit(state, log, { type: "characterKOd", player: battle.defenderOwner, iid: battle.targetIid, donReturned: given });
    // "When this Character battles and K.O.'s your opponent's Character" (M5)
    if (isOnField(state, battle.attackerOwner, battle.attackerIid)) enqueueAutoEffects(db, state, battle.attackerOwner, battle.attackerIid, "onKOInBattle");
    pump(db, state, log);
  }
}

/** "When your opponent's Character is K.O.'d" (M3): fulfilled for the other
 *  player's field cards. */
function enqueueKOdReactionsLocal(db: CardDb, state: AutoGameState, koOwner: PID): void {
  const reactor = opponentOf(state, koOwner);
  for (const iid of fieldIids(state, reactor)) {
    enqueueAutoEffects(db, state, reactor, iid, "onOpponentCharacterKOd");
  }
}

/** A damage's Life card goes to the hand — or, face-up under "Your face-up Life
 *  cards are placed at the bottom of your deck instead" (Leader, M5), to the deck. */
function damageToHand(db: CardDb, state: AutoGameState, log: GameEvent[], pid: PID, iid: Iid): void {
  const p = state.players[pid];
  if (p.instances[iid].faceUp && hasRestriction(db, state, pid, p.leaderIid, "faceUpLifeToDeck")) {
    emitLife(db, state, log, { type: "returnedToDeck", player: pid, iid, where: "bottom", from: "life" });
    return;
  }
  emitLife(db, state, log, { type: "lifeCardToHand", player: pid, iid });
}

/** Process `remaining` damage instances against the defender's Life, one card
 *  at a time (7-1-4-1-1). Returns true if suspended on a [Trigger] decision
 *  (8-6-2-1); the rest of the damage waits in battle.pendingDamage. */
function processDamage(db: CardDb, state: AutoGameState, log: GameEvent[], remaining: number): boolean {
  const battle = state.battle!;
  const defId = battle.defenderOwner;
  const def = state.players[defId];
  const banish = keywordsOf(db, state, battle.attackerOwner, battle.attackerIid).has("Banish");
  // "When this card's attack deals damage to your opponent's Life" (M5): once per battle
  if (remaining > 0 && def.zones.life.length > 0 && !battle.damageReacted) {
    battle.damageReacted = true;
    enqueueReactions(db, state, battle.attackerOwner, [battle.attackerIid], "onDealDamage", {});
    for (const iid of fieldIids(state, battle.attackerOwner)) enqueueAutoEffects(db, state, battle.attackerOwner, iid, "onYouDealDamage"); // "When you deal damage" (M5)
    for (const iid of fieldIids(state, defId)) enqueueAutoEffects(db, state, defId, iid, "onTakeDamage"); // "When you take damage" (M5)
  }

  while (remaining > 0) {
    // "If you would take damage, you may trash this Character instead." (M5) — asked for each damage
    const rep = damageReplacement(db, state, defId, battle.damageDeclined ?? []);
    if (rep) {
      battle.pendingDamage = remaining;
      state.pendingChoice = { kind: "mayReplace", player: defId, sourceIid: rep.sourceIid, effectIndex: rep.effectIndex, targetIid: rep.sourceIid, battle: false, damage: true };
      return true;
    }
    battle.damageDeclined = [];
    remaining -= 1;
    battle.pendingDamage = remaining;
    // 7-1-4-1-1-1 / 9-2-1-1: damage dealt at 0 Life → the attacker wins
    if (def.zones.life.length === 0) {
      emit(state, log, { type: "gameEnded", winner: battle.attackerOwner, reason: "leaderDamageAtZeroLife" });
      return false;
    }
    const top = def.zones.life[def.zones.life.length - 1];
    if (banish) {
      // 10-1-3-1 [Banish]: trash instead of adding to hand; NO [Trigger]
      emitLife(db, state, log, { type: "lifeCardTrashed", player: defId, iid: top });
      continue;
    }
    const cardId = def.instances[top].cardId;
    const trigger = triggerEffectOf(db, cardId);
    // offer the [Trigger] only if it is actually activatable right now
    // (conditions 8-4-1-1, payable cost 8-3-1-3)
    if (trigger && conditionsMet(db, state, defId, top, trigger.fx.conditions)
        && canPayCost(db, state, defId, top, trigger.fx.cost)) {
      // 8-6-2-1: temporarily suspend damage processing; the owner decides
      // whether to reveal and activate the [Trigger] (10-1-5-1/2)
      state.pendingChoice = { kind: "triggerDecision", player: defId, iid: top, cardId };
      return true;
    }
    // 7-1-4-1-1-2: the top Life card goes to the hand (unrevealed)
    damageToHand(db, state, log, defId, top);
  }
  battle.pendingDamage = 0;
  return false;
}

/** A replacement for the damage `pid` would take (M5, battle damage). */
function damageReplacement(db: CardDb, state: AutoGameState, pid: PID, declined: string[]): { sourceIid: Iid; effectIndex: number } | null {
  for (const src of fieldIids(state, pid)) {
    const effects = db(state.players[pid].instances[src].cardId).compiled?.effects ?? [];
    for (const [effectIndex, fx] of effects.entries()) {
      if (fx.timing !== "replacement" || !fx.replaces?.events.includes("damage")) continue;
      if (declined.includes(`${src}:${effectIndex}`)) continue;
      if (!conditionsMet(db, state, pid, src, fx.conditions)) continue;
      if (fx.oncePerTurn && state.oncePerTurnUsed[`${pid}:${src}:${effectIndex}`] === state.turn) continue;
      if (!canPayCost(db, state, pid, src, fx.cost)) continue;
      return { sourceIid: src, effectIndex };
    }
  }
  return null;
}

/** "deal N damage to your opponent" (M5): one damage at a time, as in
 *  battle (7-1-4-1-1) — at 0 Life the player loses, else the top Life card
 *  goes to the hand, its [Trigger] offered first. True when paused. */
function effectDamage(db: CardDb, state: AutoGameState, log: GameEvent[], r: RunningEffect, action: Extract<Action, { kind: "dealDamage" }>): boolean {
  const pid = action.who === "opponent" ? opponentOf(state, r.controller) : r.controller;
  const def = state.players[pid];
  if (r.damageLeft === undefined) {
    r.damageLeft = action.count;
    if (action.count > 0 && def.zones.life.length > 0) {
      for (const iid of fieldIids(state, pid)) enqueueAutoEffects(db, state, pid, iid, "onTakeDamage"); // "When you take damage"
      const by = opponentOf(state, pid);
      if (by === r.controller) for (const iid of fieldIids(state, by)) enqueueAutoEffects(db, state, by, iid, "onYouDealDamage");
    }
  }
  while (r.damageLeft > 0) {
    r.damageLeft -= 1;
    if (def.zones.life.length === 0) {
      emit(state, log, { type: "gameEnded", winner: opponentOf(state, pid), reason: "leaderDamageAtZeroLife" }); // 9-2-1-1
      return true;
    }
    const top = def.zones.life[def.zones.life.length - 1];
    const cardId = def.instances[top].cardId;
    const trigger = triggerEffectOf(db, cardId);
    if (trigger && conditionsMet(db, state, pid, top, trigger.fx.conditions) && canPayCost(db, state, pid, top, trigger.fx.cost)) {
      state.pendingChoice = { kind: "triggerDecision", player: pid, iid: top, cardId, effectDamage: true };
      return true;
    }
    damageToHand(db, state, log, pid, top);
  }
  delete r.damageLeft;
  return false;
}

function triggerEffectOf(db: CardDb, cardId: string): { fx: Effect; effectIndex: number } | null {
  const compiled = db(cardId).compiled;
  if (!compiled) return null;
  const effectIndex = compiled.effects.findIndex((fx) => fx.timing === "trigger");
  return effectIndex === -1 ? null : { fx: compiled.effects[effectIndex], effectIndex };
}

/** Answer to a triggerDecision (10-1-5): activate the [Trigger] instead of
 *  adding the card to hand, or decline and add it unrevealed. */
export function resolveTriggerDecision(db: CardDb, state: AutoGameState, log: GameEvent[], activate: boolean): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "triggerDecision") throw new EngineError("no trigger decision pending");
  if (choice.effectDamage) { // M5: the damage of a "deal 1 damage" effect — that effect goes on afterwards
    const ex = state.exec!;
    state.pendingChoice = null;
    if (!activate) {
      damageToHand(db, state, log, choice.player, choice.iid);
    } else {
      emitLife(db, state, log, { type: "triggerActivated", player: choice.player, iid: choice.iid, cardId: choice.cardId });
      const trig = triggerEffectOf(db, choice.cardId)!;
      ex.suspended = [...(ex.suspended ?? []), ex.running!];
      beginEffect(db, state, log, choice.player, choice.iid, choice.cardId, trig.effectIndex, { triggerCard: { iid: choice.iid, moved: false } });
    }
    pump(db, state, log);
    return;
  }
  const battle = state.battle!;
  const exec = state.exec!; // survived the damage suspension
  state.pendingChoice = null;

  if (!activate) {
    // 10-1-5-2: add to hand without revealing
    damageToHand(db, state, log, choice.player, choice.iid);
    exec.flow = { at: "damage", remaining: battle.pendingDamage };
    pump(db, state, log);
    return;
  }

  // 10-1-5-1: reveal the card and activate its [Trigger]; while it resolves
  // the card belongs to no area (10-1-5-3)
  emitLife(db, state, log, { type: "triggerActivated", player: choice.player, iid: choice.iid, cardId: choice.cardId });
  const trigger = triggerEffectOf(db, choice.cardId)!;
  beginEffect(db, state, log, choice.player, choice.iid, choice.cardId, trigger.effectIndex, {
    triggerCard: { iid: choice.iid, moved: false },
  });
  exec.flow = { at: "damage", remaining: battle.pendingDamage };
  pump(db, state, log);
}

/** Apply a removal action, first offering each target's owner their
 *  replacement effects (8-1-3-4, M5). True when paused on `mayReplace`. */
function applyGuarded(db: CardDb, state: AutoGameState, log: GameEvent[], r: RunningEffect, action: Action, targets: TargetRef[]): boolean {
  const event = removalOf(action);
  if (!event) {
    applyAction(db, state, log, r.controller, r, action, targets);
    return false;
  }
  const g = r.guard ?? (r.guard = { action, targets, declined: [], replaced: [] });
  for (const t of targets) {
    if (g.replaced.includes(t.iid)) continue;
    const declined = g.declined.filter((d) => d.startsWith(`${t.iid}|`)).map((d) => d.slice(t.iid.length + 1));
    const reps = findReplacements(db, state, t.owner, t.iid, event, r.controller, declined);
    if (reps.length > 0) {
      state.pendingChoice = { kind: "mayReplace", player: t.owner, sourceIid: reps[0].sourceIid, effectIndex: reps[0].effectIndex, targetIid: t.iid, battle: false };
      return true;
    }
  }
  r.guard = undefined;
  applyAction(db, state, log, r.controller, r, action, targets.filter((t) => !g.replaced.includes(t.iid)));
  return false;
}

/** Answer to a mayReplace (8-1-3-4, M5). */
export function resolveReplace(db: CardDb, state: AutoGameState, log: GameEvent[], use: boolean): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "mayReplace") throw new EngineError("no replacement choice pending");
  state.pendingChoice = null;
  const cardId = state.players[choice.player].instances[choice.sourceIid].cardId;
  const tag = `${choice.sourceIid}:${choice.effectIndex}`;
  if (choice.damage) { // M5: "If you would take damage, you may … instead"
    const battle = state.battle!;
    const exec = state.exec!;
    if (!use) {
      (battle.damageDeclined ??= []).push(tag);
      exec.flow = { at: "damage", remaining: battle.pendingDamage };
      pump(db, state, log);
      return;
    }
    battle.damageDeclined = [];
    beginEffect(db, state, log, choice.player, choice.sourceIid, cardId, choice.effectIndex);
    exec.flow = { at: "damage", remaining: Math.max(0, battle.pendingDamage - 1) }; // this damage is replaced
    pump(db, state, log);
    return;
  }
  if (choice.battle) {
    const battle = state.battle!;
    if (!use) {
      (battle.koDeclined ??= []).push(tag);
      battleKO(db, state, log);
      return;
    }
    endBattle(db, state, log);                 // the Character stays; the battle ends (7-1-5)
    beginEffect(db, state, log, choice.player, choice.sourceIid, cardId, choice.effectIndex);
    state.exec!.running!.lastTargets = [{ owner: choice.player, iid: choice.targetIid }]; // "it" = the protected card (M5)
    pump(db, state, log);
    return;
  }
  const exec = state.exec!;
  const r = exec.running!;
  if (!use) {
    r.guard!.declined.push(`${choice.targetIid}|${tag}`);
    pump(db, state, log);
    return;
  }
  r.guard!.replaced.push(choice.targetIid);
  exec.suspended = [...(exec.suspended ?? []), r];
  beginEffect(db, state, log, choice.player, choice.sourceIid, cardId, choice.effectIndex);
  exec.running!.lastTargets = [{ owner: choice.player, iid: choice.targetIid }]; // "it" = the protected card (M5)
  pump(db, state, log);
}

/** "cannot be K.O.'d in battle" (10-2-1-3) — optionally only against
 *  attackers with given attributes / only Characters (M5). */
function battleImmune(db: CardDb, state: AutoGameState, battle: NonNullable<AutoGameState["battle"]>): boolean {
  const attacker = db(state.players[battle.attackerOwner].instances[battle.attackerIid].cardId);
  const attrs = attributesOf(state, battle.attackerIid, attacker); // M5: gained attributes count
  return activeModifiers(db, state).some((m) => m.kind === "restriction" && m.restriction === "cannotBeKOdInBattle"
    && m.targetOwner === battle.defenderOwner && m.targetIid === battle.targetIid
    && (!m.attributes || m.attributes.some((a) => attrs.includes(a)))
    && (!m.exceptAttributes || !m.exceptAttributes.some((a) => attrs.includes(a)))
    && (!m.attackerCharactersOnly || attacker.category === "Character")
    && (!m.attackerLeadersOnly || attacker.category === "Leader"));
}

// ─── choice resumptions used by engine.ts ────────────────────────────────────

/** Apply the paused action (or cost item) with the chosen targets and resume. */
export function resolveTargets(db: CardDb, state: AutoGameState, log: GameEvent[], iids: Iid[]): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "selectTargets") throw new EngineError("no target selection pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  const targets: TargetRef[] = iids.map((iid) => {
    const c = choice.candidates.find((x) => x.iid === iid)!;
    return { owner: c.owner, iid };
  });
  state.pendingChoice = null;
  if (r.costIndex >= r.costs.length && r.awaitingRoom?.length) {
    // the pause was the Character to trash by rule for the one being played (3-7-6-1)
    const next = r.awaitingRoom.shift()!;
    for (const t of targets) emit(state, log, { type: "characterTrashedByRule", player: t.owner, iid: t.iid });
    playCharacterFromZone(db, state, log, r.controller, r, next.action, next.target);
    pump(db, state, log);
    return;
  }
  if (r.costIndex < r.costs.length) {
    // the pause was a payment choice (8-3-1)
    const item = r.costs[r.costIndex];
    if (item.kind === "action") applyAction(db, state, log, r.controller, r, item.action, targets);
    else applyCostTargets(db, state, log, r, item, targets);
    r.costIndex += 1;
  } else {
    const action = r.actions[r.actionIndex];
    if (applyGuarded(db, state, log, r, action, targets)) return; // paused on a replacement choice
    r.actionIndex += 1;
  }
  pump(db, state, log);
}

/** Answer to a mayActivate (8-1-2). */
export function resolveMay(db: CardDb, state: AutoGameState, log: GameEvent[], activate: boolean): void {
  const exec = state.exec;
  const q = exec?.pendingMay;
  if (!exec || !q) throw new EngineError("no optional effect pending");
  exec.pendingMay = null;
  state.pendingChoice = null;
  if (activate) {
    startEffect(db, state, log, q);
  } else {
    emit(state, log, { type: "effectDeclined", player: q.controller, sourceIid: q.sourceIid, effectIndex: q.effectIndex });
  }
  pump(db, state, log);
}

/** Acknowledge a manualResolve prompt: log it and move past the action. */
export function resolveManual(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "manualResolve") throw new EngineError("no manual resolution pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  state.pendingChoice = null;
  emit(state, log, { type: "manualResolved", player: choice.player, sourceIid: choice.sourceIid, text: choice.text });
  r.actionIndex += 1;
  pump(db, state, log);
}

/** Answer to a payDon (DON!!−X composition, 8-3-1-6). Validated by engine.ts. */
export function resolvePayDon(
  db: CardDb, state: AutoGameState, log: GameEvent[],
  fromActive: number, fromRested: number, fromGiven: Record<Iid, number>,
): void {
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  state.pendingChoice = null;
  emit(state, log, { type: "donPaid", player: r.controller, fromActive, fromRested, fromGiven });
  donReturned(db, state, r.controller, fromActive + fromRested + Object.values(fromGiven).reduce((s, n) => s + n, 0), r.controller);
  r.costIndex += 1;
  pump(db, state, log);
}

/** Answer to a chooseOption (M5). A cost option replaces the "oneOf" item
 *  with its items; an effect option runs right after the chooseOne action. */
export function resolveOption(db: CardDb, state: AutoGameState, log: GameEvent[], index: number): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "chooseOption") throw new EngineError("no option choice pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  state.pendingChoice = null;
  if (choice.purpose === "cost") {
    const item = r.costs[r.costIndex];
    if (item.kind !== "oneOf") throw new EngineError("no cost alternative pending");
    r.costs.splice(r.costIndex, 1, ...item.options[index]);
  } else {
    const action = r.actions[r.actionIndex];
    if (action.kind === "mayPay") {
      // paid like an activation cost (8-3-1), then the "if you do" part
      if (index === 0) {
        r.costs.push(...structuredClone(action.cost));
        r.actions.splice(r.actionIndex + 1, 0, ...action.then);
      }
      r.actionIndex += 1;
      pump(db, state, log);
      return;
    }
    if (action.kind !== "chooseOne") throw new EngineError("no chooseOne pending");
    r.actions.splice(r.actionIndex + 1, 0, ...action.options[index]);
    r.actionIndex += 1;
  }
  pump(db, state, log);
}

/** Answer to an arrangeLife (M5; validated by engine.ts): the chosen cards
 *  go to the top of the deck (first = top), the rest back in the given order. */
export function resolveArrangeLife(db: CardDb, state: AutoGameState, log: GameEvent[], order: Iid[], toDeck: Iid[]): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "arrangeLife") throw new EngineError("no Life arrangement pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  state.pendingChoice = null;
  for (const iid of [...toDeck].reverse()) {
    emitLife(db, state, log, { type: "returnedToDeck", player: choice.lifeOwner, iid, where: "top", from: "life" });
  }
  emit(state, log, { type: "lifeArranged", player: choice.lifeOwner, order });
  r.actionIndex += 1;
  pump(db, state, log);
}

/** Answer to a chooseNumber ("draw up to N", 8-4-4-1). */
export function resolveNumber(db: CardDb, state: AutoGameState, log: GameEvent[], value: number): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "chooseNumber") throw new EngineError("no number choice pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  state.pendingChoice = null;
  if (choice.purpose === "draw" && value > 0) effectDraw(db, state, log, r.controller, value);
  if (choice.purpose === "restDon") { // "rest any number of your DON!!" (M5)
    if (value > 0) emit(state, log, { type: "donRestedByEffect", player: r.controller, count: value });
    r.lastTargets = [];
    r.lastCount = value;
  }
  if (choice.purpose === "standDon" && value > 0) { // "set up to N of your DON!! as active" (M5)
    const src = state.players[r.controller].instances[r.sourceIid];
    const locked = src && db(src.cardId).category === "Character" && state.modifiers.some((m) => m.kind === "restriction"
      && m.restriction === "cannotStandDonByCharacters" && m.targetOwner === r.controller);
    if (!locked) emit(state, log, { type: "donStood", player: r.controller, count: value });
  }
  if (choice.purpose === "addDon" && value > 0) { // "add up to N DON!!" (M5)
    const act = r.actions[r.actionIndex];
    emit(state, log, { type: "donAdded", player: r.controller, count: value, rested: act.kind === "placeDonInCostArea" ? act.rested ?? false : false });
  }
  if (choice.purpose === "declare") { // "Choose a cost" (M5)
    r.declared = value;
    emit(state, log, { type: "costDeclared", player: r.controller, value });
  }
  const action = r.actions[r.actionIndex];
  if (choice.purpose === "life" && value > 0 && action.kind === "addToLife") {
    const pid = action.sel.owner === "opponent" ? opponentOf(state, r.controller) : r.controller;
    addDeckTopToLife(state, log, pid, value, !!action.faceUp, action.bottom ? "bottom" : "top");
  }
  r.actionIndex += 1;
  pump(db, state, log);
}

/** Answer to a peekSelect. Validated by engine.ts. */
export function resolvePeek(
  db: CardDb, state: AutoGameState, log: GameEvent[],
  take: Iid[], restTop: Iid[], restBottom: Iid[],
): void {
  state.pendingChoice = null;
  resolvePeekWith(db, state, log, take, restTop, restBottom);
  pump(db, state, log);
}

/** Queue a card's [On Play] effects (10-2-6) and resolve them. */
export function startOnPlayEffects(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, iid: Iid): void {
  ensureExec(state, { at: "none" });
  enqueueAutoEffects(db, state, player, iid, "onPlay");
  pump(db, state, log);
}

/** [Activate: Main] (10-2-2, M3): validated by engine.ts; runs the effect. */
export function startActivateMain(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, iid: Iid, effectIndex: number): void {
  const cardId = state.players[player].instances[iid].cardId;
  ensureExec(state, { at: "none" });
  beginEffect(db, state, log, player, iid, cardId, effectIndex);
  pump(db, state, log);
}

/** End Phase (6-6-1): queue [End of Your Turn] (turn player) and [End of Your
 *  Opponent's Turn] (the other player) — the toEndTurn flow then passes the
 *  turn. Caller is engine.ts (endTurn intent). */
export function startEndPhase(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID): void {
  const exec = ensureExec(state, { at: "toEndTurn" });
  exec.flow = { at: "toEndTurn" };
  // 6-6-1-1: the turn player's [End of Your Turn] effects, then
  // 6-6-1-2: the non-turn player's [End of Your Opponent's Turn] — same
  // fulfillment, turn-player-first ordering (8-6-1) handles the sequence
  for (const iid of fieldIids(state, player)) enqueueAutoEffects(db, state, player, iid, "endOfYourTurn");
  const other = opponentOf(state, player);
  for (const iid of fieldIids(state, other)) enqueueAutoEffects(db, state, other, iid, "endOfOpponentsTurn");
  // M5: "… at the end of this turn" effects scheduled during this turn
  const due = (state.scheduled ?? []).filter((x) => x.turn === state.turn);
  if (due.length > 0) emit(state, log, { type: "scheduledQueued", turn: state.turn });
  for (const x of due) {
    exec.queue.push({ controller: x.controller, sourceIid: x.sourceIid, sourceCardId: x.sourceCardId, effectIndex: x.effectIndex, gen: exec.gen, anyZone: true,
      ...(x.subject ? { subject: x.subject } : {}) });
  }
  pump(db, state, log);
}
