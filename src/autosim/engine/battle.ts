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
  applyAction, canBlock, canPayCost, conditionsMet, drawCards, isOnField,
  matchesFilter, planAction, resolveSelector, type TargetRef,
} from "./effects";
import {
  effectivePower, hasRestriction, isPlayersFirstTurn, keywordsOf, opponentOf,
  type AutoGameState, type CardDb, type FlowResume, type Iid, type PID,
  type QueuedEffect, type RunningEffect,
} from "./state";
import { enqueueAutoEffects, ensureExec, nextGeneration, takeNext } from "./triggers";

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
export function endBattle(db: CardDb, state: AutoGameState, _log: GameEvent[]): void {
  if (!state.battle) return;
  const exec = ensureExec(state, { at: "toBattleCleanup" });
  exec.flow = { at: "toBattleCleanup" };
  // 7-1-5-2: your own and your opponent's end-of-battle effects activate
  for (const pid of [state.turnPlayer, opponentOf(state, state.turnPlayer)]) {
    for (const iid of fieldIids(state, pid)) enqueueAutoEffects(db, state, pid, iid, "endOfBattle");
  }
}

// ─── turn start (6-2 … 6-4) — here so the End Phase flow can call it ─────────

export function startTurn(state: AutoGameState, log: GameEvent[], player: PID, turn: number): void {
  emit(state, log, { type: "turnStarted", turn, player });

  // Refresh Phase (6-2): return given DON rested (6-2-3), then stand all (6-2-4)
  const p = state.players[player];
  const givenTotal = Object.values(p.don.given).reduce((s, n) => s + n, 0);
  if (givenTotal > 0) emit(state, log, { type: "givenDonReturned", player, count: givenTotal });
  emit(state, log, { type: "allStood", player });

  // Draw Phase (6-3): the first player does not draw on their first turn
  if (!(player === state.order[0] && turn === 1)) {
    drawCards(state, log, player, 1);
    if (state.phase === "over") return; // deck-out during draw
  }

  // DON!! Phase (6-4): 2, or 1 on the first player's first turn; capped by deck
  const wanted = player === state.order[0] && turn === 1 ? 1 : 2;
  const count = Math.min(wanted, p.don.deck); // 6-4-2 / 6-4-3
  if (count > 0) emit(state, log, { type: "donPlaced", player, count });
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
      // 1b — actions (1-3-7 written order)
      if (r.actionIndex >= r.actions.length) {
        // effect done — a [Trigger] card is trashed unless an action moved it (10-1-5-3)
        if (r.triggerCard && !r.triggerCard.moved) {
          emit(state, log, { type: "triggerCardTrashed", player: r.controller, iid: r.triggerCard.iid });
        }
        exec.running = null;
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
        };
        return;
      }
      if (plan.kind === "peek") {
        if (openPeek(db, state, log)) return; // peekSelect pending
        continue;
      }
      if (plan.kind === "chooseNumber") {
        // "draw up to N" — 8-4-4-1: 'up to' allows 0
        state.pendingChoice = { kind: "chooseNumber", player: r.controller, sourceIid: r.sourceIid, min: 0, max: plan.max, purpose: "draw" };
        return;
      }
      applyAction(db, state, log, r.controller, r, action, plan.targets);
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
      if (q.fromTrash) {
        if (!state.players[q.controller].zones.trash.includes(q.sourceIid)) continue;
      } else if (!isOnField(state, q.controller, q.sourceIid)) continue;
      if (!conditionsMet(db, state, q.controller, q.sourceIid, fx.conditions)) continue; // 8-4-1-1
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
        }
        r.costIndex += 1;
        continue;

      case "trashSelf": // trash this card as a cost (2-7, same movement as the rule trash)
        emit(state, log, { type: "characterTrashedByRule", player: r.controller, iid: r.sourceIid });
        r.costIndex += 1;
        continue;

      case "trashFromLife": { // top Life card(s) → trash (3-10 ordering)
        for (let i = 0; i < item.count && p.zones.life.length > 0; i++) {
          emit(state, log, { type: "lifeCardTrashed", player: r.controller, iid: p.zones.life[p.zones.life.length - 1] });
        }
        r.costIndex += 1;
        continue;
      }

      case "lifeToHand": { // "add N from your Life to your hand:" (M3) — top cards
        for (let i = 0; i < item.count && p.zones.life.length > 0; i++) {
          emit(state, log, { type: "lifeCardToHand", player: r.controller, iid: p.zones.life[p.zones.life.length - 1] });
        }
        r.costIndex += 1;
        continue;
      }

      case "returnDonToDeck": { // DON!!−X (8-3-1-6)
        const given = Object.values(p.don.given).reduce((s, n) => s + n, 0);
        if (given === 0) {
          // only cost-area DON available: auto-compose, rested first (never worse)
          const fromRested = Math.min(item.count, p.don.rested);
          const fromActive = item.count - fromRested;
          emit(state, log, { type: "donPaid", player: r.controller, fromActive, fromRested, fromGiven: {} });
          r.costIndex += 1;
          continue;
        }
        // attached DON make the composition a real choice
        state.pendingChoice = { kind: "payDon", player: r.controller, sourceIid: r.sourceIid, amount: item.count };
        return true;
      }

      case "trashFromHand":
      case "returnToHand":
      case "restFromField": {
        const sel = item.sel;
        const candidates = resolveSelector(db, state, r.controller, r.sourceIid, sel);
        if (candidates.length <= sel.count) {
          applyCostTargets(state, log, r, item, candidates.slice(0, sel.count));
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

      case "handToDeckBottom": { // "place N from your hand at the bottom of your deck:" (M3)
        const candidates: TargetRef[] = p.zones.hand.map((iid) => ({ owner: r.controller, iid }));
        if (candidates.length <= item.count) {
          applyCostTargets(state, log, r, item, candidates);
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

/** Apply a card-choice cost item with its chosen targets. */
function applyCostTargets(
  state: AutoGameState, log: GameEvent[], r: RunningEffect, item: CostItem, targets: TargetRef[],
): void {
  switch (item.kind) {
    case "trashFromHand":
      if (targets.length > 0) {
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
  const mode: "hand" | "play" | "none" = then.addToHand ? "hand" : then.play ? "play" : "none";
  const filter = then.addToHand ?? then.play;
  let takeCount = mode === "hand" ? (then.addCount ?? 1) : mode === "play" ? (then.playCount ?? 1) : 0;
  if (mode === "play") {
    takeCount = Math.min(takeCount, 5 - p.zones.characterArea.length); // 3-7-6
  }
  const eligible = mode === "none" || takeCount <= 0
    ? []
    : cards.filter((iid) => matchesFilter(db, state, r.controller, iid, filter, r.sourceIid, false));

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
  const mode: "hand" | "play" | "none" = then.addToHand ? "hand" : then.play ? "play" : "none";

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
  emit(state, log, {
    type: "peekResolved", player: r.controller,
    toHand: mode === "hand" ? take : [],
    played: mode === "play" ? take.map((iid) => ({ iid, rested: !!then.playRested })) : [],
    top, bottom, trashed,
  });
  if (mode === "play") {
    // 10-2-6: [On Play] timings fulfilled by effect plays too
    for (const iid of take) enqueueAutoEffects(db, state, r.controller, iid, "onPlay");
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

    case "toEndTurn": {
      // End Phase effects resolved (6-6-1-1/2) → durations expire in the
      // turnEnded reducer (6-6-1-3/4), then the next turn starts
      const player = state.turnPlayer;
      emit(state, log, { type: "turnEnded", turn: state.turn, player });
      startTurn(state, log, opponentOf(state, player), state.turn + 1);
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
  if (hasRestriction(db, state, player, attackerIid, "cannotAttack")) {
    throw new EngineError("this card cannot attack (effect restriction)");
  }

  // 7-1-1-2: target = opponent's Leader, or one of their RESTED characters —
  // unless an effect grants "can also attack active Characters" (M3)
  const targetIsLeader = targetIid === opp.leaderIid;
  const targetIsChar = opp.zones.characterArea.includes(targetIid);
  if (!targetIsLeader && !targetIsChar) throw new EngineError("target must be the opponent's Leader or Character");
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
  enqueueAutoEffects(db, state, player, attackerIid, "whenAttacking");
  for (const iid of fieldIids(state, oppId)) {
    enqueueAutoEffects(db, state, oppId, iid, "onYourOpponentsAttack");
  }
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
  }
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
  emit(state, log, { type: "eventCardUsed", player, iid: cardIid, donRested });
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
          || hasRestriction(db, state, battle.defenderOwner, battle.targetIid, "cannotBeKOdInBattle")) {
    // 10-2-1-3: the Character is not K.O.'d by the battle — nothing happens
    endBattle(db, state, log);
    pump(db, state, log);
  } else {
    // 7-1-4-1-2: the Character is K.O.'d. Its [On K.O.] timing is fulfilled on
    // the field (10-2-17-1) and resolves after damage processing (8-6-2).
    ensureExec(state, { at: "toEndBattle" });
    enqueueAutoEffects(db, state, battle.defenderOwner, battle.targetIid, "onKO", { fromTrash: true });
    enqueueKOdReactionsLocal(db, state, battle.defenderOwner);
    const given = def.don.given[battle.targetIid] ?? 0;
    emit(state, log, { type: "characterKOd", player: battle.defenderOwner, iid: battle.targetIid, donReturned: given });
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

/** Process `remaining` damage instances against the defender's Life, one card
 *  at a time (7-1-4-1-1). Returns true if suspended on a [Trigger] decision
 *  (8-6-2-1); the rest of the damage waits in battle.pendingDamage. */
function processDamage(db: CardDb, state: AutoGameState, log: GameEvent[], remaining: number): boolean {
  const battle = state.battle!;
  const defId = battle.defenderOwner;
  const def = state.players[defId];
  const banish = keywordsOf(db, state, battle.attackerOwner, battle.attackerIid).has("Banish");

  while (remaining > 0) {
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
      emit(state, log, { type: "lifeCardTrashed", player: defId, iid: top });
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
    emit(state, log, { type: "lifeCardToHand", player: defId, iid: top });
  }
  battle.pendingDamage = 0;
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
  const battle = state.battle!;
  const exec = state.exec!; // survived the damage suspension
  state.pendingChoice = null;

  if (!activate) {
    // 10-1-5-2: add to hand without revealing
    emit(state, log, { type: "lifeCardToHand", player: choice.player, iid: choice.iid });
    exec.flow = { at: "damage", remaining: battle.pendingDamage };
    pump(db, state, log);
    return;
  }

  // 10-1-5-1: reveal the card and activate its [Trigger]; while it resolves
  // the card belongs to no area (10-1-5-3)
  emit(state, log, { type: "triggerActivated", player: choice.player, iid: choice.iid, cardId: choice.cardId });
  const trigger = triggerEffectOf(db, choice.cardId)!;
  beginEffect(db, state, log, choice.player, choice.iid, choice.cardId, trigger.effectIndex, {
    triggerCard: { iid: choice.iid, moved: false },
  });
  exec.flow = { at: "damage", remaining: battle.pendingDamage };
  pump(db, state, log);
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
  if (r.costIndex < r.costs.length) {
    // the pause was a payment choice (8-3-1)
    applyCostTargets(state, log, r, r.costs[r.costIndex], targets);
    r.costIndex += 1;
  } else {
    const action = r.actions[r.actionIndex];
    applyAction(db, state, log, r.controller, r, action, targets);
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
  r.costIndex += 1;
  pump(db, state, log);
}

/** Answer to a chooseNumber ("draw up to N", 8-4-4-1). */
export function resolveNumber(db: CardDb, state: AutoGameState, log: GameEvent[], value: number): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "chooseNumber") throw new EngineError("no number choice pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  state.pendingChoice = null;
  if (choice.purpose === "draw" && value > 0) drawCards(state, log, r.controller, value);
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
  pump(db, state, log);
}
