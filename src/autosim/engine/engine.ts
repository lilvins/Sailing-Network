/**
 * AUTOSIM engine — the single writer. `createGame` builds the initial state
 * and runs setup; `applyIntent` validates a PlayerIntent, resolves it into
 * events, and folds them via `applyEvent`. Pure and synchronous: no side
 * effects, no Promises, RNG only through seeded derivations recorded in
 * events. Rule references point at docs/rules/op_comprehensive_rules_v1.2.0.txt.
 *
 * M1: battle machine + effect pump in battle.ts; tier-1 executor in
 * effects.ts; 8-6 queue in triggers.ts. M3: [Activate: Main] intent, the
 * peek/payDon/chooseNumber windows, End Phase effects and the tier-2 executor.
 */
import {
  afterBlockResolved, beginEffect, declareAttack, enqueueEventActivationReactions,
  pump, resolveManual, resolveMay, resolveNumber, resolveOption, resolveReplace, resolvePayDon, resolvePeek,
  resolveArrangeLife, resolveTargets, resolveTriggerDecision, shuffleDeck, startActivateMain,
  startDamageStep, startEndPhase, startOnPlayEffects, startTurn,
  useCounterEventCard,
} from "./battle";
import { canPayCost, canPayEventCost, conditionsMet, playLocked, satisfiesSet, watchers } from "./effects";
import { emit, type GameEvent } from "./events";
import { EngineError, type PlayerIntent } from "./intents";
import {
  effectiveCost, effectiveCounter, hasRestriction, isNegated, opponentOf, playDiscountFor,
  type AutoGameState, type AutoPlayerState, type CardDb, type EngineCard, type Iid, type PID,
} from "./state";
import type { SelectorFilter } from "../ir/types";
import { enqueueAutoEffects, ensureExec } from "./triggers";

export interface GameConfig {
  seed: string;
  players: [
    { id: PID; leader: string; deck: string[] }, // deck = 50 cardIds (5-1-2)
    { id: PID; leader: string; deck: string[] },
  ];
  /** Which player goes first (the RPS + choice of 5-2-1-4/5, decided outside). */
  firstPlayer: PID;
}

/** The engine appends events here as it works; callers read it for logs/UI. */
export interface EngineResult {
  state: AutoGameState;
  events: GameEvent[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function requirePlayer(state: AutoGameState, pid: PID): AutoPlayerState {
  const p = state.players[pid];
  if (!p) throw new EngineError(`unknown player ${pid}`);
  return p;
}

function requireGameRunning(state: AutoGameState): void {
  if (state.phase === "over") throw new EngineError("game is over");
}

function requireNoPendingChoice(state: AutoGameState): void {
  if (state.pendingChoice) throw new EngineError(`pending choice: ${state.pendingChoice.kind}`);
}

function requireMainActionWindow(state: AutoGameState, player: PID): void {
  requireGameRunning(state);
  requireNoPendingChoice(state);
  if (state.phase !== "main") throw new EngineError("not in the Main Phase");
  if (state.turnPlayer !== player) throw new EngineError("not your turn");
  if (state.battle) throw new EngineError("a battle is in progress");
}

// ─── setup (5-2) ─────────────────────────────────────────────────────────────

/** Build the initial state and run pre-game setup up to the first mulligan
 *  decision (the engine then waits on ChoiceRequests). */
export function createGame(db: CardDb, config: GameConfig): EngineResult {
  const [a, b] = config.players;
  if (config.firstPlayer !== a.id && config.firstPlayer !== b.id) {
    throw new EngineError("firstPlayer must be one of the players");
  }
  const order: [PID, PID] =
    config.firstPlayer === a.id ? [a.id, b.id] : [b.id, a.id];

  const mkPlayer = (pc: { id: PID; leader: string; deck: string[] }, seat: string): AutoPlayerState => {
    // deck construction rules (5-1-2, checked at presentation per 5-2-1-1)
    if (pc.deck.length !== 50) throw new EngineError(`${pc.id}: deck must have exactly 50 cards (5-1-2)`);
    const leaderCard = db(pc.leader);
    if (leaderCard.category !== "Leader") throw new EngineError(`${pc.id}: leader card is not a Leader`);
    const leaderColors = new Set(leaderCard.colors);
    const copies = new Map<string, number>();
    for (const cardId of pc.deck) copies.set(cardId, (copies.get(cardId) ?? 0) + 1);
    const leaderRules = leaderCard.compiled?.rules ?? {};
    for (const [cardId, n] of copies) {
      const card = db(cardId);
      // 5-1-2-3 / 2-14-2: no more than 4 cards with the same card number
      // ("you may have any number of this card in your deck": M5)
      if (n > 4 && !card.compiled?.rules?.anyCopies) throw new EngineError(`${pc.id}: ${n} copies of ${cardId} (max 4, 5-1-2-3)`);
      // Leader deck rules ("Under the rules of this game …", M5)
      if (leaderRules.deckBan && deckRuleMatch(card, leaderRules.deckBan)) throw new EngineError(`${pc.id}: ${cardId} is not allowed by the Leader's rule`);
      if (leaderRules.deckOnly && !deckRuleMatch(card, leaderRules.deckOnly)) throw new EngineError(`${pc.id}: ${cardId} is not allowed by the Leader's rule`);
      // 5-1-2-1: main deck holds Character/Event/Stage cards only
      if (card.category === "Leader") throw new EngineError(`${pc.id}: ${cardId} is a Leader — not a deck card (5-1-2-1)`);
      // 5-1-2-2: only colors included on the Leader card
      if (!card.colors.some((c) => leaderColors.has(c))) {
        throw new EngineError(`${pc.id}: ${cardId} colors [${card.colors.join(",")}] not on the leader (5-1-2-2)`);
      }
    }
    const p: AutoPlayerState = {
      id: pc.id,
      leaderIid: `${seat}#L`,
      zones: { deck: [], hand: [], trash: [], life: [], characterArea: [], stage: [] },
      instances: {},
      don: { deck: leaderRules.donDeck ?? 10, active: 0, rested: 0, given: {} }, // 5-1-2: 10-card DON!! deck (a Leader rule may change it, M5)
      mulliganResolved: false,
      ...(leaderRules.winsOnDeckOut ? { deckOutWins: true } : {}),
      ...(leaderRules.deckOutLosesAtEndOfTurn ? { deckOutAtEnd: true } : {}),
    };
    p.instances[p.leaderIid] = { iid: p.leaderIid, cardId: pc.leader, rested: false };
    pc.deck.forEach((cardId, i) => {
      const iid = `${seat}#${i}`;
      p.instances[iid] = { iid, cardId, rested: false };
      p.zones.deck.push(iid);
    });
    return p;
  };

  const state: AutoGameState = {
    seed: config.seed,
    rngUses: 0,
    order,
    turn: 0,
    turnPlayer: order[0],
    phase: "setup",
    players: {
      [a.id]: mkPlayer(a, a.id === order[0] ? "p1" : "p2"),
      [b.id]: mkPlayer(b, b.id === order[0] ? "p1" : "p2"),
    },
    battle: null,
    modifiers: [],
    oncePerTurnUsed: {},
    exec: null,
    pendingChoice: null,
    winner: null,
    winReason: null,
  };

  const log: GameEvent[] = [];
  emit(state, log, { type: "gameStarted", seed: config.seed, order });
  // "at the start of the game, play up to 1 {X} type Stage card from your deck" (Leader rule, M5)
  for (const pid of order) {
    const p = state.players[pid];
    const rule = db(p.instances[p.leaderIid].cardId).compiled?.rules?.startOfGamePlay;
    const pick = rule && p.zones.deck.find((iid) => deckRuleMatch(db(p.instances[iid].cardId), rule));
    if (pick) emit(state, log, { type: "startOfGameStage", player: pid, iid: pick });
  }
  // 5-2-1-2: shuffle; 5-2-1-6: draw 5 each, then mulligans starting with first
  for (const pid of order) {
    shuffleDeck(state, log, pid);
    const p = state.players[pid];
    emit(state, log, { type: "cardsDrawn", player: pid, iids: p.zones.deck.slice(0, 5) });
  }
  state.pendingChoice = { kind: "mulligan", player: order[0] };
  return { state, events: log };
}

/** A deck-construction rule filter, on the printed card (M5). */
function deckRuleMatch(card: EngineCard, f: SelectorFilter): boolean {
  if (f.category && !f.category.includes(card.category)) return false;
  if (f.typeIncludes && !f.typeIncludes.some((t) => card.types.includes(t))) return false;
  if (f.costAtLeast !== undefined && (card.cost ?? 0) < f.costAtLeast) return false;
  if (f.costAtMost !== undefined && (card.cost ?? 0) > f.costAtMost) return false;
  return true;
}

/** After both mulligans: deal Life (5-2-1-7) and start the first turn. */
function finishSetup(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  for (const pid of state.order) {
    const p = state.players[pid];
    const lifeValue = db(p.instances[p.leaderIid].cardId).cost ?? 0; // Leader cost = Life (local DB quirk)
    emit(state, log, { type: "lifeDealt", player: pid, iids: p.zones.deck.slice(0, lifeValue) });
  }
  startTurn(db, state, log, state.order[0], 1);
  if (state.exec) pump(db, state, log); // M5: start-of-turn / DON!! Phase effects
}

// ─── intent handling ─────────────────────────────────────────────────────────

/** The game's entry point: works on a copy, so `prev` is never changed and an
 *  illegal intent (EngineError) leaves the game exactly as it was. */
export function applyIntent(db: CardDb, prev: AutoGameState, intent: PlayerIntent): EngineResult {
  return applyIntentInPlace(db, structuredClone(prev), intent);
}

/** For simulations only (the bot's rollouts, the benchmark): changes `state`
 *  itself instead of a copy, which saves a deep copy per intent. If it throws,
 *  `state` may be half-changed — throw the whole simulated game away. Never
 *  call it on the state of the real game. */
export function applyIntentInPlace(db: CardDb, state: AutoGameState, intent: PlayerIntent): EngineResult {
  const log: GameEvent[] = [];

  switch (intent.type) {
    case "respondMulligan": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "mulligan" || choice.player !== intent.player) {
        throw new EngineError("no mulligan pending for this player");
      }
      const p = requirePlayer(state, intent.player);
      if (intent.take) {
        // 5-2-1-6-1: return hand, reshuffle, redraw 5
        emit(state, log, { type: "mulliganResolved", player: intent.player, taken: true, returnedToDeck: [...p.zones.hand] });
        shuffleDeck(state, log, intent.player);
        emit(state, log, { type: "cardsDrawn", player: intent.player, iids: p.zones.deck.slice(0, 5) });
      } else {
        emit(state, log, { type: "mulliganResolved", player: intent.player, taken: false, returnedToDeck: [] });
      }
      // next: second player's mulligan, or finish setup
      const [first, second] = state.order;
      if (intent.player === first) {
        state.pendingChoice = { kind: "mulligan", player: second };
      } else {
        state.pendingChoice = null;
        finishSetup(db, state, log);
      }
      break;
    }

    case "playCard": {
      requireMainActionWindow(state, intent.player);
      const p = requirePlayer(state, intent.player);
      if (!p.zones.hand.includes(intent.iid)) throw new EngineError("card not in hand");
      const card = db(p.instances[intent.iid].cardId);
      const cost = effectiveCost(db, state, intent.player, intent.iid); // base + costMods (M3)
      if (p.don.active < cost) throw new EngineError(`not enough active DON!! (${p.don.active}/${cost})`);
      if (playLocked(db, state, intent.player, intent.iid, true)) throw new EngineError("you cannot play this card this turn (effect)");
      // "the next time you play [X] …, the cost will be reduced" (M5): spent by this play
      const discount = playDiscountFor(db, state, intent.player, intent.iid);
      if (discount) emit(state, log, { type: "playDiscountUsed", player: intent.player, source: discount.source });

      if (card.category === "Character") {
        if (playLocked(db, state, intent.player, intent.iid)) throw new EngineError("you cannot play this Character this turn (effect)");
        // 3-7-6-1: with 5 characters, trash one (by rule) before playing
        if (p.zones.characterArea.length >= 5) {
          if (!intent.replaceIid || !p.zones.characterArea.includes(intent.replaceIid)) {
            throw new EngineError("character area full — replaceIid required (3-7-6-1)");
          }
          emit(state, log, { type: "characterTrashedByRule", player: intent.player, iid: intent.replaceIid });
        }
        watchers(db, state, "onYouPlayCharacter", intent.player, intent.iid, undefined);
        emit(state, log, { type: "cardPlayed", player: intent.player, iid: intent.iid, donRested: cost, zone: "characterArea",
          ...(hasRestriction(db, state, intent.player, p.leaderIid, "charactersPlayedRested") ? { rested: true } : {}) });
        // 10-2-6 [On Play]: activation timing fulfilled by the play
        startOnPlayEffects(db, state, log, intent.player, intent.iid);
      } else if (card.category === "Stage") {
        // 3-8-5-1: with 1 stage, trash it before playing
        if (p.zones.stage.length >= 1) {
          const toTrash = intent.replaceIid ?? p.zones.stage[0];
          if (!p.zones.stage.includes(toTrash)) throw new EngineError("replaceIid is not the current stage");
          emit(state, log, { type: "characterTrashedByRule", player: intent.player, iid: toTrash });
        }
        emit(state, log, { type: "cardPlayed", player: intent.player, iid: intent.iid, donRested: cost, zone: "stage" });
        startOnPlayEffects(db, state, log, intent.player, intent.iid);
      } else if (card.category === "Event") {
        // 10-2-3 [Main]: an Event is played in the Main Phase only through a
        // [Main] effect; [Counter]/[Trigger]-only Events are not playable here.
        const effects = card.compiled?.effects ?? [];
        const mainIndex = effects.findIndex((fx) => fx.timing === "main");
        if (effects.length > 0 && mainIndex === -1) {
          throw new EngineError("this Event has no [Main] effect (10-2-3)");
        }
        if (mainIndex >= 0) {
          const fx = effects[mainIndex];
          // card activation = 8-4-1: conditions must hold and costs be payable
          if (!conditionsMet(db, state, intent.player, intent.iid, fx.conditions)) {
            throw new EngineError("[Main] effect conditions not met (8-4-1-1)");
          }
          if (!canPayEventCost(db, state, intent.player, intent.iid, cost, fx.cost)) {
            throw new EngineError("cannot pay the [Main] effect's activation cost (8-3-1-3)");
          }
        }
        // 2-7-3 / 8-4-2: pay, trash, activate
        emit(state, log, { type: "eventCardUsed", player: intent.player, iid: intent.iid, donRested: cost, baseCost: card.cost ?? 0 });
        // "when you/your opponent activates an Event" (8-5-2, M3) — resolved
        // after the Event's own effect (8.6.3)
        ensureExec(state, { at: "none" });
        enqueueEventActivationReactions(db, state, intent.player);
        if (mainIndex >= 0) {
          beginEffect(db, state, log, intent.player, intent.iid, p.instances[intent.iid].cardId, mainIndex);
        }
        pump(db, state, log);
      } else {
        throw new EngineError("cannot play a Leader card");
      }
      break;
    }

    case "activateMain": {
      // 10-2-2-1 / 6-5-4: during your Main Phase, outside battle (M3)
      requireMainActionWindow(state, intent.player);
      const p = requirePlayer(state, intent.player);
      const onField = intent.iid === p.leaderIid
        || p.zones.characterArea.includes(intent.iid) || p.zones.stage.includes(intent.iid);
      if (!onField) throw new EngineError("the card must be on your field");
      const compiled = db(p.instances[intent.iid].cardId).compiled;
      const fx = compiled?.effects[intent.effectIndex];
      if (!fx || fx.timing !== "activateMain") throw new EngineError("not an [Activate: Main] effect (10-2-2)");
      if (isNegated(state, intent.player, intent.iid, db)) throw new EngineError("this card's effects are negated");
      if (fx.oncePerTurn && state.oncePerTurnUsed[`${intent.player}:${intent.iid}:${intent.effectIndex}`] === state.turn) {
        throw new EngineError("already activated this turn (10-2-13-3)");
      }
      if (!conditionsMet(db, state, intent.player, intent.iid, fx.conditions)) {
        throw new EngineError("activation conditions not met (8-4-1-1)");
      }
      if (!canPayCost(db, state, intent.player, intent.iid, fx.cost)) {
        throw new EngineError("cannot pay the activation cost (8-3-1-3)");
      }
      startActivateMain(db, state, log, intent.player, intent.iid, intent.effectIndex);
      break;
    }

    case "giveDon": {
      requireMainActionWindow(state, intent.player);
      const p = requirePlayer(state, intent.player);
      if (p.don.active < 1) throw new EngineError("no active DON!! to give");
      const isOwnBoardCard =
        intent.targetIid === p.leaderIid || p.zones.characterArea.includes(intent.targetIid);
      if (!isOwnBoardCard) throw new EngineError("DON!! can only be given to your Leader or Characters (6-5-5-1)");
      emit(state, log, { type: "donGiven", player: intent.player, targetIid: intent.targetIid });
      // "When this Leader or any of your Characters is given a DON!! card" (M5)
      if ([p.leaderIid, ...p.zones.characterArea, ...p.zones.stage].some((iid) => db(p.instances[iid].cardId).compiled?.effects.some((fx) => fx.timing === "onDonGiven"))) {
        ensureExec(state, { at: "none" });
        for (const iid of [p.leaderIid, ...p.zones.characterArea, ...p.zones.stage]) enqueueAutoEffects(db, state, intent.player, iid, "onDonGiven");
        pump(db, state, log);
      }
      break;
    }

    case "attack": {
      requireMainActionWindow(state, intent.player);
      declareAttack(db, state, log, intent.player, intent.attackerIid, intent.targetIid);
      break;
    }

    case "respondBlock": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "blockWindow" || choice.player !== intent.player) {
        throw new EngineError("no block window pending for this player");
      }
      if (intent.blockerIid && !choice.blockers.includes(intent.blockerIid)) {
        throw new EngineError("illegal blocker");
      }
      state.pendingChoice = null;
      emit(state, log, { type: "blockWindowResolved", blockerIid: intent.blockerIid });
      afterBlockResolved(db, state, intent.blockerIid); // [On Block] queue (7-1-2-2)
      pump(db, state, log);
      break;
    }

    case "useCounter": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "counterWindow" || choice.player !== intent.player) {
        throw new EngineError("no counter window pending for this player");
      }
      const p = requirePlayer(state, intent.player);
      if (!p.zones.hand.includes(intent.cardIid)) throw new EngineError("counter card not in hand");
      const card = db(p.instances[intent.cardIid].cardId);
      // 7-1-3-2-1: a Character card with a counter value, trashed from hand
      const counter = effectiveCounter(db, state, intent.player, intent.cardIid);
      if (card.category !== "Character" || counter <= 0) {
        throw new EngineError("card has no counter value");
      }
      const isOwnLeaderOrChar =
        intent.targetIid === p.leaderIid || p.zones.characterArea.includes(intent.targetIid);
      if (!isOwnLeaderOrChar) throw new EngineError("counter target must be your Leader or a Character");
      emit(state, log, {
        type: "counterApplied", player: intent.player,
        cardIid: intent.cardIid, targetIid: intent.targetIid, amount: counter,
      });
      // window stays open (7-1-3-2: as many times as they wish)
      break;
    }

    case "useCounterEvent": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "counterWindow" || choice.player !== intent.player) {
        throw new EngineError("no counter window pending for this player");
      }
      const p = requirePlayer(state, intent.player);
      if (!p.zones.hand.includes(intent.cardIid)) throw new EngineError("counter event not in hand");
      const card = db(p.instances[intent.cardIid].cardId);
      // 7-1-3-2-2 / 10-2-4: an Event card with [Counter] in hand
      const effects = card.compiled?.effects ?? [];
      const counterFx = effects.find((fx) => fx.timing === "counter");
      if (card.category !== "Event" || !counterFx) {
        throw new EngineError("card is not an Event with a [Counter] effect (10-2-4)");
      }
      if (!conditionsMet(db, state, intent.player, intent.cardIid, counterFx.conditions)) {
        throw new EngineError("[Counter] effect conditions not met (8-4-1-1)");
      }
      // pay the card's cost (7-1-3-2-2) in active DON, plus the effect's own
      // activation cost (M3: validated as a whole, paid by the pump)
      const cardCost = effectiveCost(db, state, intent.player, intent.cardIid);
      const restDonNeed = (counterFx.cost ?? []).reduce((s, c) => s + (c.kind === "restDon" ? c.count : 0), 0);
      if (p.don.active < cardCost + restDonNeed) {
        throw new EngineError(`not enough active DON!! (${p.don.active}/${cardCost + restDonNeed})`);
      }
      if (!canPayEventCost(db, state, intent.player, intent.cardIid, cardCost, counterFx.cost)) {
        throw new EngineError("cannot pay the [Counter] effect's activation cost (8-3-1-3)");
      }
      useCounterEventCard(db, state, log, intent.player, intent.cardIid, cardCost);
      break;
    }

    case "passCounter": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "counterWindow" || choice.player !== intent.player) {
        throw new EngineError("no counter window pending for this player");
      }
      state.pendingChoice = null;
      emit(state, log, { type: "counterWindowClosed", player: intent.player });
      startDamageStep(db, state, log);
      break;
    }

    case "respondTrigger": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "triggerDecision" || choice.player !== intent.player) {
        throw new EngineError("no trigger decision pending for this player");
      }
      resolveTriggerDecision(db, state, log, intent.activate);
      break;
    }

    case "respondTargets": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "selectTargets" || choice.player !== intent.player) {
        throw new EngineError("no target selection pending for this player");
      }
      const unique = new Set(intent.iids);
      if (unique.size !== intent.iids.length) throw new EngineError("duplicate targets");
      for (const iid of intent.iids) {
        if (!choice.candidates.some((c) => c.iid === iid)) throw new EngineError(`illegal target ${iid}`);
      }
      // 8-4-4-1: choose as many as you can up to the number specified;
      // with "up to", 0 is allowed too
      const max = Math.min(choice.count, choice.candidates.length);
      if (choice.upTo ? intent.iids.length > max : intent.iids.length !== max) {
        throw new EngineError(`must select ${choice.upTo ? "at most" : "exactly"} ${max} target(s) (8-4-4-1)`);
      }
      const set = { totalCostAtMost: choice.totalCostAtMost, totalPowerAtMost: choice.totalPowerAtMost, distinctNames: choice.distinctNames };
      if (set.totalCostAtMost !== undefined || set.totalPowerAtMost !== undefined || set.distinctNames) {
        const chosen = intent.iids.map((iid) => choice.candidates.find((c) => c.iid === iid)!);
        if (!satisfiesSet(db, state, chosen, set)) throw new EngineError("the chosen cards break the total cost / power or different-names limit");
      }
      resolveTargets(db, state, log, intent.iids);
      break;
    }

    case "respondMay": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "mayActivate" || choice.player !== intent.player) {
        throw new EngineError("no optional activation pending for this player");
      }
      resolveMay(db, state, log, intent.activate);
      break;
    }

    case "ackManual": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "manualResolve" || choice.player !== intent.player) {
        throw new EngineError("no manual resolution pending for this player");
      }
      resolveManual(db, state, log);
      break;
    }

    case "respondPeek": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "peekSelect" || choice.player !== intent.player) {
        throw new EngineError("no peek selection pending for this player");
      }
      const take = intent.take;
      if (new Set(take).size !== take.length) throw new EngineError("duplicate take");
      for (const iid of take) {
        if (!choice.eligible.includes(iid)) throw new EngineError(`illegal take ${iid}`);
      }
      if (take.length > choice.takeCount) {
        throw new EngineError(`may take at most ${choice.takeCount} card(s) (8-4-4-1)`);
      }
      const remaining = choice.cards.filter((iid) => !take.includes(iid));
      const restTop = intent.restTop ?? [];
      const restBottom = intent.restBottom ?? [];
      const samePerm = (arr: Iid[], of: Iid[]) =>
        arr.length === of.length && new Set(arr).size === arr.length && arr.every((x) => of.includes(x));
      switch (choice.rest) {
        case "topAnyOrder":
          if (restBottom.length > 0 || (restTop.length > 0 && !samePerm(restTop, remaining))) {
            throw new EngineError("the rest must go on top of the deck (in any order)");
          }
          break;
        case "bottomAnyOrder":
          if (restTop.length > 0 || (restBottom.length > 0 && !samePerm(restBottom, remaining))) {
            throw new EngineError("the rest must go to the bottom of the deck (in any order)");
          }
          break;
        case "topOrBottomAnyOrder": {
          const all = [...restTop, ...restBottom];
          if (!samePerm(all, remaining)) {
            throw new EngineError("the rest must be split between top and bottom of the deck");
          }
          break;
        }
        case "shuffle":
        case "trash":
          if (restTop.length > 0 || restBottom.length > 0) {
            throw new EngineError(`the rest is ${choice.rest === "shuffle" ? "shuffled into" : "trashed"} — no ordering`);
          }
          break;
      }
      resolvePeek(db, state, log, take, restTop, restBottom);
      break;
    }

    case "respondPayDon": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "payDon" || choice.player !== intent.player) {
        throw new EngineError("no DON!! payment pending for this player");
      }
      const p = requirePlayer(state, intent.player);
      const { fromActive, fromRested, fromGiven } = intent;
      const ints = [fromActive, fromRested, ...Object.values(fromGiven)];
      if (ints.some((n) => !Number.isInteger(n) || n < 0)) throw new EngineError("invalid DON!! amounts");
      if (fromActive > p.don.active) throw new EngineError("not that many active DON!!");
      if (fromRested > p.don.rested) throw new EngineError("not that many rested DON!!");
      for (const [iid, n] of Object.entries(fromGiven)) {
        if (n > (p.don.given[iid] ?? 0)) throw new EngineError(`not that many DON!! on ${iid}`);
      }
      const total = fromActive + fromRested + Object.values(fromGiven).reduce((s, n) => s + n, 0);
      if (total !== choice.amount) throw new EngineError(`must return exactly ${choice.amount} DON!! (8-3-1-6)`);
      resolvePayDon(db, state, log, fromActive, fromRested, fromGiven);
      break;
    }

    case "respondNumber": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "chooseNumber" || choice.player !== intent.player) {
        throw new EngineError("no number choice pending for this player");
      }
      if (!Number.isInteger(intent.value) || intent.value < choice.min || intent.value > choice.max) {
        throw new EngineError(`value must be between ${choice.min} and ${choice.max}`);
      }
      resolveNumber(db, state, log, intent.value);
      break;
    }

    case "respondReplace": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "mayReplace" || choice.player !== intent.player) {
        throw new EngineError("no replacement choice pending for this player");
      }
      resolveReplace(db, state, log, intent.use);
      break;
    }

    case "respondOption": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "chooseOption" || choice.player !== intent.player) {
        throw new EngineError("no option choice pending for this player");
      }
      if (!Number.isInteger(intent.index) || !choice.enabled[intent.index]) {
        throw new EngineError(`option ${intent.index} is not available`);
      }
      resolveOption(db, state, log, intent.index);
      break;
    }

    case "respondArrangeLife": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "arrangeLife" || choice.player !== intent.player) {
        throw new EngineError("no Life arrangement pending for this player");
      }
      const all = [...intent.order, ...intent.toDeck];
      if (intent.toDeck.length !== choice.toDeckTop || all.length !== choice.cards.length
        || new Set(all).size !== all.length || !all.every((iid) => choice.cards.includes(iid))) {
        throw new EngineError(`place every Life card back, ${choice.toDeckTop} of them on top of the deck`);
      }
      resolveArrangeLife(db, state, log, intent.order, intent.toDeck);
      break;
    }

    case "endTurn": {
      requireMainActionWindow(state, intent.player);
      // End Phase (6-6-1): [End of Your Turn] / [End of Your Opponent's Turn]
      // effects first, then durations expire and the turn passes (M3).
      startEndPhase(db, state, log, intent.player);
      break;
    }

    case "concede": {
      requireGameRunning(state);
      requirePlayer(state, intent.player);
      // 1-2-3: a player may concede at any point
      emit(state, log, { type: "gameEnded", winner: opponentOf(state, intent.player), reason: "concession" });
      break;
    }

    default: {
      // runtime guard for malformed input (network/UI); `never` keeps the
      // switch exhaustive at compile time
      const exhaustive: never = intent;
      throw new EngineError(`unknown intent type: ${(exhaustive as { type?: string }).type}`);
    }
  }

  return { state, events: log };
}
