/**
 * AUTOSIM engine — the single writer. `createGame` builds the initial state
 * and runs setup; `applyIntent` validates a PlayerIntent, resolves it into
 * events, and folds them via `applyEvent`. Pure and synchronous: no side
 * effects, no Promises, RNG only through seeded derivations recorded in
 * events. Rule references point at docs/rules/op_comprehensive_rules_v1.2.0.txt.
 */
import { seededRng, shuffleWith } from "../../lib/rng";
import { applyEvent, type GameEvent } from "./events";
import { EngineError, type PlayerIntent } from "./intents";
import {
  effectivePower,
  isPlayersFirstTurn,
  opponentOf,
  type AutoGameState,
  type AutoPlayerState,
  type CardDb,
  type Iid,
  type PID,
} from "./state";

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

function emit(state: AutoGameState, log: GameEvent[], e: GameEvent): void {
  applyEvent(state, e);
  log.push(e);
}

/** Deterministic shuffle: derives from seed + per-state use counter; the
 *  resulting order is recorded in the event so replay never needs RNG. */
function shuffleDeck(state: AutoGameState, log: GameEvent[], player: PID): void {
  const rand = seededRng(`${state.seed}:${state.rngUses++}`);
  const order = shuffleWith(state.players[player].zones.deck, rand);
  emit(state, log, { type: "deckShuffled", player, order });
}

function drawCards(state: AutoGameState, log: GameEvent[], player: PID, count: number): void {
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
      } else if (card.category === "Stage") {
        // 3-8-5-1: with 1 stage, trash it before playing
        if (p.zones.stage.length >= 1) {
          const toTrash = intent.replaceIid ?? p.zones.stage[0];
          if (!p.zones.stage.includes(toTrash)) throw new EngineError("replaceIid is not the current stage");
          emit(state, log, { type: "characterTrashedByRule", player: intent.player, iid: toTrash });
        }
        emit(state, log, { type: "cardPlayed", player: intent.player, iid: intent.iid, donRested: cost, zone: "stage" });
      } else if (card.category === "Event") {
        // 2-7-3: pay, trash, activate. M0 runs no effects — the use is logged.
        emit(state, log, { type: "eventCardUsed", player: intent.player, iid: intent.iid, donRested: cost });
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
      declareAttack(state, log, intent.player, intent.attackerIid, intent.targetIid);
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
      openCounterWindow(state);
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

    case "passCounter": {
      requireGameRunning(state);
      const choice = state.pendingChoice;
      if (!choice || choice.kind !== "counterWindow" || choice.player !== intent.player) {
        throw new EngineError("no counter window pending for this player");
      }
      state.pendingChoice = null;
      emit(state, log, { type: "counterWindowClosed", player: intent.player });
      resolveDamageStep(db, state, log);
      break;
    }

    case "endTurn": {
      requireMainActionWindow(state, intent.player);
      // End Phase (6-6): M0 has no end-of-turn effects; durations thisTurn
      // would expire here (none exist in M0).
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

// ─── battle (7) ──────────────────────────────────────────────────────────────

function declareAttack(state: AutoGameState, log: GameEvent[], player: PID, attackerIid: Iid, targetIid: Iid): void {
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
  // 3-7-4: characters cannot attack the turn they were played ([Rush] is M1)
  if (isChar && attacker.playedOnTurn === state.turn) {
    throw new EngineError("character was played this turn (3-7-4)");
  }

  // 7-1-1-2: target = opponent's Leader, or one of their RESTED characters
  const targetIsLeader = targetIid === opp.leaderIid;
  const targetIsChar = opp.zones.characterArea.includes(targetIid);
  if (!targetIsLeader && !targetIsChar) throw new EngineError("target must be the opponent's Leader or Character");
  if (targetIsChar && !opp.instances[targetIid].rested) {
    throw new EngineError("only RESTED characters can be attacked (7-1-1-2)");
  }

  emit(state, log, { type: "attackDeclared", attackerOwner: player, attackerIid, defenderOwner: oppId, targetIid });
  // 7-1-1-3 attack-step effects: none in M0.

  // Block Step (7-1-2): M0 has no [Blocker] keyword — auto-resolve with none.
  const blockers: Iid[] = []; // M1: opp's active characters with [Blocker]
  if (blockers.length > 0) {
    state.pendingChoice = { kind: "blockWindow", player: oppId, blockers };
  } else {
    emit(state, log, { type: "blockWindowResolved", blockerIid: null });
    openCounterWindow(state);
  }
}

function openCounterWindow(state: AutoGameState): void {
  if (!state.battle) return;
  // 7-1-3: the attacked player acts; the engine always opens the window —
  // the defender passes if they have nothing (UI can auto-pass).
  state.pendingChoice = { kind: "counterWindow", player: state.battle.defenderOwner };
}

function resolveDamageStep(db: CardDb, state: AutoGameState, log: GameEvent[]): void {
  const battle = state.battle;
  if (!battle) return;
  const attPower = effectivePower(db, state, battle.attackerOwner, battle.attackerIid);
  const defPower = effectivePower(db, state, battle.defenderOwner, battle.targetIid);
  const def = state.players[battle.defenderOwner];
  const targetIsLeader = battle.targetIid === def.leaderIid;

  // 7-1-4-1: attacker wins ties
  if (attPower >= defPower) {
    emit(state, log, { type: "battleWon", attackerIid: battle.attackerIid, targetIid: battle.targetIid });
    if (targetIsLeader) {
      // 7-1-4-1-1-1: lethal on 0 Life
      if (def.zones.life.length === 0) {
        emit(state, log, { type: "gameEnded", winner: battle.attackerOwner, reason: "leaderDamageAtZeroLife" });
        return;
      }
      // 7-1-4-1-1-2: top Life card to hand ([Trigger]/[Double Attack] are M1)
      const top = def.zones.life[def.zones.life.length - 1];
      emit(state, log, { type: "lifeCardToHand", player: battle.defenderOwner, iid: top });
    } else {
      // 7-1-4-1-2: character K.O.
      const given = def.don.given[battle.targetIid] ?? 0;
      emit(state, log, { type: "characterKOd", player: battle.defenderOwner, iid: battle.targetIid, donReturned: given });
    }
  } else {
    emit(state, log, { type: "battleLost", attackerIid: battle.attackerIid, targetIid: battle.targetIid });
  }
  // 7-1-5: end of battle (M0: no end-of-battle effects)
  emit(state, log, { type: "battleEnded" });
}
