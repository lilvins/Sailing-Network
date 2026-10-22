/**
 * AUTOSIM engine — the single writer. `createGame` builds the initial state
 * and runs setup; `applyIntent` validates a PlayerIntent, resolves it into
 * events, and folds them via `applyEvent`. Pure and synchronous: no side
 * effects, no Promises, RNG only through seeded derivations recorded in
 * events. Rule references point at docs/rules/op_comprehensive_rules_v1.2.0.txt.
 *
 * M1: the battle machine + effect pump live in battle.ts; the tier-1 action
 * executor in effects.ts; the 8-6 auto-effect queue in triggers.ts.
 */
import { seededRng, shuffleWith } from "../../lib/rng";
import {
  afterBlockResolved, declareAttack, pump, resolveManual, resolveMay,
  resolveTargets, resolveTriggerDecision, startDamageStep, startOnPlayEffects,
  useCounterEventCard,
} from "./battle";
import { canPayCost, conditionsMet, drawCards, payCost } from "./effects";
import { emit, type GameEvent } from "./events";
import { EngineError, type PlayerIntent } from "./intents";
import {
  opponentOf,
  type AutoGameState, type AutoPlayerState, type CardDb, type Iid, type PID,
} from "./state";
import { ensureExec, nextGeneration } from "./triggers";

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

/** Deterministic shuffle: derives from seed + per-state use counter; the
 *  resulting order is recorded in the event so replay never needs RNG. */
function shuffleDeck(state: AutoGameState, log: GameEvent[], player: PID): void {
  const rand = seededRng(`${state.seed}:${state.rngUses++}`);
  const order = shuffleWith(state.players[player].zones.deck, rand);
  emit(state, log, { type: "deckShuffled", player, order });
}

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
    for (const [cardId, n] of copies) {
      // 5-1-2-3 / 2-14-2: no more than 4 cards with the same card number
      if (n > 4) throw new EngineError(`${pc.id}: ${n} copies of ${cardId} (max 4, 5-1-2-3)`);
      const card = db(cardId);
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
      don: { deck: 10, active: 0, rested: 0, given: {} }, // 5-1-2: 10-card DON!! deck
      mulliganResolved: false,
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
  // 5-2-1-2: shuffle; 5-2-1-6: draw 5 each, then mulligans starting with first
  for (const pid of order) {
    shuffleDeck(state, log, pid);
    const p = state.players[pid];
    emit(state, log, { type: "cardsDrawn", player: pid, iids: p.zones.deck.slice(0, 5) });
  }
  state.pendingChoice = { kind: "mulligan", player: order[0] };
  return { state, events: log };
}

/** After both mulligans: deal Life (5-2-1-7) and start the first turn. */
function finishSetup(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  for (const pid of state.order) {
    const p = state.players[pid];
    const lifeValue = db(p.instances[p.leaderIid].cardId).cost ?? 0; // Leader cost = Life (local DB quirk)
    emit(state, log, { type: "lifeDealt", player: pid, iids: p.zones.deck.slice(0, lifeValue) });
  }
  startTurn(state, log, state.order[0], 1);
}

// ─── turn flow (6) ───────────────────────────────────────────────────────────

function startTurn(state: AutoGameState, log: GameEvent[], player: PID, turn: number): void {
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

// ─── intent handling ─────────────────────────────────────────────────────────

export function applyIntent(db: CardDb, prev: AutoGameState, intent: PlayerIntent): EngineResult {
  const state = structuredClone(prev);
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
      const cost = card.cost ?? 0;
      if (p.don.active < cost) throw new EngineError(`not enough active DON!! (${p.don.active}/${cost})`);

      if (card.category === "Character") {
        // 3-7-6-1: with 5 characters, trash one (by rule) before playing
        if (p.zones.characterArea.length >= 5) {
          if (!intent.replaceIid || !p.zones.characterArea.includes(intent.replaceIid)) {
            throw new EngineError("character area full — replaceIid required (3-7-6-1)");
          }
          emit(state, log, { type: "characterTrashedByRule", player: intent.player, iid: intent.replaceIid });
        }
        emit(state, log, { type: "cardPlayed", player: intent.player, iid: intent.iid, donRested: cost, zone: "characterArea" });
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
          if (!canPayCost(state, intent.player, intent.iid, fx.cost)) {
            throw new EngineError("cannot pay the [Main] effect's activation cost (8-3-1-3)");
          }
        }
        // 2-7-3 / 8-4-2: pay, trash, activate
        emit(state, log, { type: "eventCardUsed", player: intent.player, iid: intent.iid, donRested: cost });
        if (mainIndex >= 0) {
          useEventEffect(db, state, log, intent.player, intent.iid, mainIndex);
        }
      } else {
        throw new EngineError("cannot play a Leader card");
      }
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
      if (card.category !== "Character" || !card.counter) {
        throw new EngineError("card has no counter value");
      }
      const isOwnLeaderOrChar =
        intent.targetIid === p.leaderIid || p.zones.characterArea.includes(intent.targetIid);
      if (!isOwnLeaderOrChar) throw new EngineError("counter target must be your Leader or a Character");
      emit(state, log, {
        type: "counterApplied", player: intent.player,
        cardIid: intent.cardIid, targetIid: intent.targetIid, amount: card.counter,
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
      // pay the card's cost (7-1-3-2-2) plus the effect's own DON costs
      let needDon = card.cost ?? 0;
      for (const c of counterFx.cost ?? []) {
        if (c.kind === "restDon" || c.kind === "returnDonToDeck") needDon += c.count;
        else throw new EngineError(`unsupported [Counter] activation cost "${c.kind}" (M1)`);
      }
      if (p.don.active < needDon) throw new EngineError(`not enough active DON!! (${p.don.active}/${needDon})`);
      useCounterEventCard(db, state, log, intent.player, intent.cardIid);
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

    case "endTurn": {
      requireMainActionWindow(state, intent.player);
      // End Phase (6-6): end-of-turn auto effects land in M2; "during this
      // turn" durations expire in the turnEnded reducer (6-6-1-3/4).
      emit(state, log, { type: "turnEnded", turn: state.turn, player: intent.player });
      const next = opponentOf(state, intent.player);
      startTurn(state, log, next, state.turn + 1);
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

/** Run a [Main] Event effect after the card was used (trashed, 8-4-2). */
function useEventEffect(db: CardDb, state: AutoGameState, log: GameEvent[], player: PID, iid: Iid, effectIndex: number): void {
  const cardId = state.players[player].instances[iid].cardId;
  const fx = db(cardId).compiled!.effects[effectIndex];
  ensureExec(state, { at: "none" });
  nextGeneration(state);
  payCost(state, log, player, iid, fx.cost);
  emit(state, log, {
    type: "effectActivated", player, sourceIid: iid, sourceCardId: cardId,
    effectIndex, timing: fx.timing, oncePerTurn: !!fx.oncePerTurn,
  });
  state.exec!.running = { controller: player, sourceIid: iid, sourceCardId: cardId, effectIndex, actionIndex: 0 };
  pump(db, state, log);
}
