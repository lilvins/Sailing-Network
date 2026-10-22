/**
 * AUTOSIM battle machine (7-1) + the effect-resolution pump (8-6) — extracted
 * from engine.ts in M1 as planned (AUTOSIM_PLAN.md "Decisioni", M0 #1).
 *
 * The pump is the single scheduler for effect resolution: it advances the
 * running effect action by action, drains the auto-effect queue with the 8-6
 * ordering, suspends while damage processing is underway (8-6-2), pauses on
 * ChoiceRequests, and finally resumes the interrupted flow (battle step /
 * damage / nothing). engine.ts validates intents and delegates here.
 */
import type { Effect } from "../ir/types";
import { emit, type GameEvent } from "./events";
import { EngineError } from "./intents";
import {
  applyAction, canBlock, canPayCost, conditionsMet, payCost, planAction, type TargetRef,
} from "./effects";
import {
  effectivePower, hasRestriction, isPlayersFirstTurn, keywordsOf, opponentOf,
  type AutoGameState, type CardDb, type FlowResume, type Iid, type PID, type QueuedEffect,
} from "./state";
import { enqueueAutoEffects, ensureExec, nextGeneration, takeNext } from "./triggers";

// ─── small helpers ───────────────────────────────────────────────────────────

function effectOf(db: CardDb, cardId: string, effectIndex: number): Effect | null {
  return db(cardId).compiled?.effects[effectIndex] ?? null;
}

function isOnField(state: AutoGameState, owner: PID, iid: Iid): boolean {
  const p = state.players[owner];
  return iid === p.leaderIid || p.zones.characterArea.includes(iid) || p.zones.stage.includes(iid);
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

export function endBattle(state: AutoGameState, log: GameEvent[]): void {
  // 7-1-5-2 "at the end of this battle" effects land in M2+ (none compiled in
  // M1's tier-1 scope). 7-1-5-3/4: thisBattle modifiers expire in the reducer.
  emit(state, log, { type: "battleEnded" });
}

// ─── the pump: effect resolution scheduler (8-6) ─────────────────────────────

/** Advance effect resolution until a ChoiceRequest pauses it, the game ends,
 *  or the interrupted flow fully resumes. Pure and synchronous. */
export function pump(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  while (state.phase !== "over") {
    const exec = state.exec;
    if (!exec) return;

    // 1 — an effect is mid-resolution: run its next action (1-3-7 order)
    if (exec.running) {
      const r = exec.running;
      const fx = effectOf(db, r.sourceCardId, r.effectIndex);
      if (!fx || r.actionIndex >= fx.actions.length) {
        // effect done — a [Trigger] card is trashed unless an action moved it (10-1-5-3)
        if (r.triggerCard && !r.triggerCard.moved) {
          emit(state, log, { type: "triggerCardTrashed", player: r.controller, iid: r.triggerCard.iid });
        }
        exec.running = null;
        continue;
      }
      const action = fx.actions[r.actionIndex];
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
      if (!canPayCost(state, q.controller, q.sourceIid, fx.cost)) continue; // 8-3-1-3
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

/** Begin resolving one queued effect: pay costs (8-4-1-3), log the activation
 *  (marks [Once Per Turn], 10-2-13-3) and set it running. */
function startEffect(db: CardDb, state: AutoGameState, log: GameEvent[], q: QueuedEffect): void {
  const fx = effectOf(db, q.sourceCardId, q.effectIndex)!;
  nextGeneration(state); // effects fulfilled from now on resolve later (8-6-1-1)
  payCost(state, log, q.controller, q.sourceIid, fx.cost);
  emit(state, log, {
    type: "effectActivated", player: q.controller, sourceIid: q.sourceIid,
    sourceCardId: q.sourceCardId, effectIndex: q.effectIndex,
    timing: fx.timing, oncePerTurn: !!fx.oncePerTurn,
  });
  state.exec!.running = {
    controller: q.controller, sourceIid: q.sourceIid, sourceCardId: q.sourceCardId,
    effectIndex: q.effectIndex, actionIndex: 0,
  };
}

function resumeFlow(db: CardDb, state: AutoGameState, log: GameEvent[], flow: FlowResume): void {
  switch (flow.at) {
    case "none":
      return; // main-phase effect finished — back to the main action window

    case "toBlockStep": {
      if (!state.battle) return;
      emit(state, log, { type: "attackStepEnded" });
      // 7-1-1-4: a participant left during the Attack Step → End of the Battle
      if (!battleIntact(state)) { endBattle(state, log); return; }
      openBlockStep(db, state, log);
      return;
    }

    case "toCounterWindow": {
      if (!state.battle) return;
      // 7-1-2-3 (and its Counter Step copy): participant left → End of Battle
      if (!battleIntact(state)) { endBattle(state, log); return; }
      openCounterWindow(state);
      return;
    }

    case "toEndBattle":
      if (state.battle) endBattle(state, log);
      return;

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
  if (hasRestriction(state, player, attackerIid, "cannotAttack")) {
    throw new EngineError("this card cannot attack (effect restriction)");
  }

  // 7-1-1-2: target = opponent's Leader, or one of their RESTED characters
  const targetIsLeader = targetIid === opp.leaderIid;
  const targetIsChar = opp.zones.characterArea.includes(targetIid);
  if (!targetIsLeader && !targetIsChar) throw new EngineError("target must be the opponent's Leader or Character");
  if (targetIsChar && !opp.instances[targetIid].rested) {
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
  for (const iid of [opp.leaderIid, ...opp.zones.characterArea]) {
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
export function useCounterEventCard(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, cardIid: Iid): void {
  const p = state.players[player];
  const cardId = p.instances[cardIid].cardId;
  const card = db(cardId);
  const effectIndex = card.compiled!.effects.findIndex((fx) => fx.timing === "counter");
  const fx = card.compiled!.effects[effectIndex];

  state.pendingChoice = null;
  emit(state, log, { type: "eventCardUsed", player, iid: cardIid, donRested: card.cost ?? 0 });
  ensureExec(state, { at: "toCounterWindow" });
  nextGeneration(state);
  payCost(state, log, player, cardIid, fx.cost); // the effect's own activation cost, if any (8-3-1)
  emit(state, log, {
    type: "effectActivated", player, sourceIid: cardIid, sourceCardId: cardId,
    effectIndex, timing: "counter", oncePerTurn: !!fx.oncePerTurn,
  });
  state.exec!.running = { controller: player, sourceIid: cardIid, sourceCardId: cardId, effectIndex, actionIndex: 0 };
  pump(db, state, log);
}

// ─── damage step (7-1-4) ─────────────────────────────────────────────────────

/** Entered from passCounter (counterWindowClosed already emitted). */
export function startDamageStep(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  // Counter Step end rule (numbered 7-1-2-3 in the text): participant left → 7-1-5
  if (!battleIntact(state)) { endBattle(state, log); return; }
  const battle = state.battle!;
  const def = state.players[battle.defenderOwner];
  const attPower = effectivePower(db, state, battle.attackerOwner, battle.attackerIid);
  const defPower = effectivePower(db, state, battle.defenderOwner, battle.targetIid);
  const targetIsLeader = battle.targetIid === def.leaderIid;

  // 7-1-4-2: attacker's power is less → the battle is lost, nothing happens
  if (attPower < defPower) {
    emit(state, log, { type: "battleLost", attackerIid: battle.attackerIid, targetIid: battle.targetIid });
    endBattle(state, log);
    return;
  }

  // 7-1-4-1: greater or equal → the battle is won
  emit(state, log, { type: "battleWon", attackerIid: battle.attackerIid, targetIid: battle.targetIid });
  if (targetIsLeader) {
    // 7-1-4-1-1: damage to the Leader — 2 with [Double Attack] (10-1-2-1,
    // 7-1-4-1-1-3), processed one Life card at a time.
    const damage = keywordsOf(db, state, battle.attackerOwner, battle.attackerIid).has("DoubleAttack") ? 2 : 1;
    ensureExec(state, { at: "damage", remaining: damage });
    state.exec!.flow = { at: "damage", remaining: damage };
    pump(db, state, log);
  } else {
    // 7-1-4-1-2: the Character is K.O.'d. Its [On K.O.] timing is fulfilled on
    // the field (10-2-17-1) and resolves after damage processing (8-6-2).
    ensureExec(state, { at: "toEndBattle" });
    enqueueAutoEffects(db, state, battle.defenderOwner, battle.targetIid, "onKO", { fromTrash: true });
    const given = def.don.given[battle.targetIid] ?? 0;
    emit(state, log, { type: "characterKOd", player: battle.defenderOwner, iid: battle.targetIid, donReturned: given });
    pump(db, state, log);
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
        && canPayCost(state, defId, top, trigger.fx.cost)) {
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
  nextGeneration(state);
  payCost(state, log, choice.player, choice.iid, trigger.fx.cost);
  emit(state, log, {
    type: "effectActivated", player: choice.player, sourceIid: choice.iid,
    sourceCardId: choice.cardId, effectIndex: trigger.effectIndex,
    timing: "trigger", oncePerTurn: !!trigger.fx.oncePerTurn,
  });
  exec.running = {
    controller: choice.player, sourceIid: choice.iid, sourceCardId: choice.cardId,
    effectIndex: trigger.effectIndex, actionIndex: 0,
    triggerCard: { iid: choice.iid, moved: false },
  };
  exec.flow = { at: "damage", remaining: battle.pendingDamage };
  pump(db, state, log);
}

// ─── choice resumptions used by engine.ts ────────────────────────────────────

/** Apply the paused action with the chosen targets and resume. */
export function resolveTargets(db: CardDb, state: AutoGameState, log: GameEvent[], iids: Iid[]): void {
  const choice = state.pendingChoice;
  if (!choice || choice.kind !== "selectTargets") throw new EngineError("no target selection pending");
  const r = state.exec?.running;
  if (!r) throw new EngineError("no effect is resolving");
  const fx = effectOf(db, r.sourceCardId, r.effectIndex)!;
  const action = fx.actions[r.actionIndex];
  const targets: TargetRef[] = iids.map((iid) => {
    const c = choice.candidates.find((x) => x.iid === iid)!;
    return { owner: c.owner, iid };
  });
  state.pendingChoice = null;
  applyAction(db, state, log, r.controller, r, action, targets);
  r.actionIndex += 1;
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

/** Queue a card's [On Play] effects (10-2-6) and resolve them. */
export function startOnPlayEffects(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, iid: Iid): void {
  ensureExec(state, { at: "none" });
  enqueueAutoEffects(db, state, player, iid, "onPlay");
  pump(db, state, log);
}
