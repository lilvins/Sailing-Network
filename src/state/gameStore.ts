import { create } from "zustand";
import { newId } from "../lib/id";
import { shuffle } from "../lib/rng";
import {
  ZONE_IDS,
  type CardInstance,
  type Decklist,
  type GameState,
  type InstanceId,
  type PlayerState,
  type ZoneId,
} from "./types";

export function createEmptyPlayer(id: string): PlayerState {
  const zones = Object.fromEntries(
    ZONE_IDS.map((z) => [z, [] as InstanceId[]]),
  ) as Record<ZoneId, InstanceId[]>;
  return { id, zones, instances: {} };
}

const EMPTY_STATE: GameState = {
  players: {},
  playerOrder: [],
  turnPlayerId: "",
  turn: 0,
  actionLog: [],
};

/** How many undo snapshots to keep. */
const HISTORY_MAX = 60;

export interface MoveCardArgs {
  playerId: string;
  instanceId: InstanceId;
  from: ZoneId;
  to: ZoneId;
  toIndex?: number;
}

/** Input for setup — caller resolves card metadata, store stays pure. */
export interface SetupInput {
  leaderId: string;
  leaderLife: number;
  main: { cardId: string; count: number }[];
}

/** Build one player's opening state (leader, shuffled deck, 5-card hand, life,
 *  a 10-card DON!! deck) plus the decklist for the setup log. Shared by `setup`
 *  (first seat) and `addSeat` (opponent in test mode). */
function buildPlayer(playerId: string, input: SetupInput): { player: PlayerState; decklist: Decklist } {
  const player = createEmptyPlayer(playerId);

  // Leader
  const leaderId = newId();
  player.instances[leaderId] = {
    instanceId: leaderId,
    cardId: input.leaderId,
    faceUp: true,
    rested: false,
  };
  player.zones.leader = [leaderId];

  // Build main deck instances (face down)
  const rawDeck: InstanceId[] = [];
  for (const { cardId, count } of input.main) {
    for (let i = 0; i < count; i++) {
      const iid = newId();
      player.instances[iid] = { instanceId: iid, cardId, faceUp: false, rested: false };
      rawDeck.push(iid);
    }
  }

  // Shuffle deck
  const deckOrder = shuffle(rawDeck);

  // Opening hand (5 cards, face up for owner)
  const handIds = deckOrder.splice(0, 5);
  for (const iid of handIds) {
    player.instances[iid] = { ...player.instances[iid], faceUp: true };
  }
  player.zones.hand = handIds;

  // Life cards (take from top of remaining deck, face down)
  const lifeIds = deckOrder.splice(0, input.leaderLife);
  player.zones.life = lifeIds;

  // Remaining deck
  player.zones.deck = deckOrder;

  // DON!! deck — 10 virtual cards with id "DON"
  for (let i = 0; i < 10; i++) {
    const iid = newId();
    player.instances[iid] = { instanceId: iid, cardId: "DON", faceUp: false, rested: false };
    player.zones.donDeck.push(iid);
  }

  const decklist: Decklist = { leader: input.leaderId, main: input.main, don: 10 };
  return { player, decklist };
}

export interface GameStore {
  state: GameState;
  /** Snapshot stack for Undo — kept OUT of the serializable state on purpose. */
  past: GameState[];
  setup: (playerId: string, input: SetupInput) => void;
  /** Add a second seat (the opponent, in test mode) without touching turn state. */
  addSeat: (playerId: string, input: SetupInput) => void;
  drawCard: (playerId: string, count?: number) => void;
  drawDon: (playerId: string, count?: number) => void;
  moveCard: (move: MoveCardArgs) => void;
  restCard: (playerId: string, instanceId: InstanceId, rested?: boolean) => void;
  flipCard: (playerId: string, instanceId: InstanceId) => void;
  attachDon: (playerId: string, instanceId: InstanceId, targetId: InstanceId | null) => void;
  refresh: (playerId: string) => void;
  setMarker: (playerId: string, instanceId: InstanceId, delta: number) => void;
  shuffleDeck: (playerId: string) => void;
  /** Declare an attack with a Leader/Character: rests it and logs the intent. */
  declareAttack: (playerId: string, instanceId: InstanceId) => void;
  /** Coin flip (sides=2) or die roll — outcome goes into the actionLog. */
  rollDie: (playerId: string, sides?: number) => void;
  /** Low-level turn counter bump (kept for tests / manual control). */
  nextTurn: () => void;
  /** Run the automatic start-of-turn phases for `playerId` per OP rules:
   *  refresh → draw 1 (skipped on turn 1) → place DON!! (1 on turn 1, else 2). */
  beginTurn: (playerId: string) => void;
  /** Semi-automatic turn pass: hand the turn to the next seat, bump the turn,
   *  then run that seat's automatic start-of-turn phases. One undo step. */
  passTurn: () => void;
  mulligan: (playerId: string) => void;
  /** Revert the last undoable action (or turn pass). */
  undo: () => void;
  resetGame: () => void;
}

export const useGameStore = create<GameStore>((set, get) => {
  // When true, composite actions (beginTurn/passTurn) suppress the per-action
  // snapshots of the sub-actions they call, so the whole batch is ONE undo step.
  let suppressHistory = false;

  /** Push the current serializable state onto the undo stack. */
  const snap = () => {
    if (suppressHistory) return;
    set((s) => ({ past: [...s.past, s.state].slice(-HISTORY_MAX) }));
  };

  return {
    state: EMPTY_STATE,
    past: [],

    setup(playerId, input) {
      const { player, decklist } = buildPlayer(playerId, input);
      set((s) => ({
        past: [],
        state: {
          ...s.state,
          players: { ...s.state.players, [playerId]: player },
          playerOrder: [playerId],
          turnPlayerId: playerId,
          turn: 1,
          actionLog: [...s.state.actionLog, { type: "setup", playerId, deck: decklist }],
        },
      }));
    },

    addSeat(playerId, input) {
      const { player, decklist } = buildPlayer(playerId, input);
      set((s) => ({
        state: {
          ...s.state,
          players: { ...s.state.players, [playerId]: player },
          playerOrder: s.state.playerOrder.includes(playerId)
            ? s.state.playerOrder
            : [...s.state.playerOrder, playerId],
          actionLog: [...s.state.actionLog, { type: "setup", playerId, deck: decklist }],
        },
      }));
    },

    drawCard(playerId, count = 1) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      snap();
      const deck = [...player.zones.deck];
      const hand = [...player.zones.hand];
      const drawn = deck.splice(0, count);
      const instances = { ...player.instances };
      for (const iid of drawn) {
        instances[iid] = { ...instances[iid], faceUp: true };
        hand.push(iid);
      }
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: { ...player, instances, zones: { ...player.zones, deck, hand } },
          },
          actionLog: [...s.state.actionLog, { type: "drawCard", playerId, count }],
        },
      }));
    },

    drawDon(playerId, count = 1) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      snap();
      const donDeck = [...player.zones.donDeck];
      const donActive = [...player.zones.donActive];
      const drawn = donDeck.splice(0, count);
      const instances = { ...player.instances };
      for (const iid of drawn) {
        instances[iid] = { ...instances[iid], faceUp: true };
        donActive.push(iid);
      }
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: { ...player, instances, zones: { ...player.zones, donDeck, donActive } },
          },
          actionLog: [...s.state.actionLog, { type: "drawDon", playerId, count }],
        },
      }));
    },

    moveCard({ playerId, instanceId, from, to, toIndex }) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      snap();
      const fromZone = player.zones[from].filter((id) => id !== instanceId);
      // Same-zone moves (e.g. deck reorder from the viewer) insert into the
      // already-filtered list, otherwise the card would be duplicated.
      const toZone = from === to ? [...fromZone] : [...player.zones[to]];
      const insertAt = toIndex !== undefined ? toIndex : toZone.length;
      toZone.splice(insertAt, 0, instanceId);

      // Auto-flip: face-up in hand/donActive/playArea, face-down in deck/life/donDeck
      const flip =
        to === "hand" || to === "donActive" || to === "playArea"
          ? true
          : to === "deck" || to === "life" || to === "donDeck"
            ? false
            : undefined;

      const instances = { ...player.instances };
      const updated: CardInstance = { ...instances[instanceId] };
      if (flip !== undefined) updated.faceUp = flip;
      if (from !== to) {
        // Moving a card always detaches it (only DON!! ever carry attachedTo)
        delete updated.attachedTo;
        // Markers and the rested state don't follow cards into piles/hand — a
        // card sitting in the trash/deck/hand is never "rested".
        if (to === "hand" || to === "deck" || to === "trash" || to === "life" || to === "donDeck") {
          delete updated.marker;
          updated.rested = false;
        }
      }
      instances[instanceId] = updated;

      // If a Leader/Character leaves the board, return any DON!! given to it
      if (from !== to && (from === "leader" || from === "characterArea")) {
        for (const iid of Object.keys(instances)) {
          if (instances[iid].attachedTo === instanceId) {
            const freed = { ...instances[iid] };
            delete freed.attachedTo;
            instances[iid] = freed;
          }
        }
      }

      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances,
              zones: { ...player.zones, [from]: fromZone, [to]: toZone },
            },
          },
          actionLog: [
            ...s.state.actionLog,
            { type: "moveCard", playerId, instanceId, from, to, toIndex },
          ],
        },
      }));
    },

    restCard(playerId, instanceId, rested) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      const inst = player.instances[instanceId];
      if (!inst) return;
      snap();
      const newRested = rested !== undefined ? rested : !inst.rested;
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances: {
                ...player.instances,
                [instanceId]: { ...inst, rested: newRested },
              },
            },
          },
          actionLog: [
            ...s.state.actionLog,
            { type: "restCard", playerId, instanceId, rested: newRested },
          ],
        },
      }));
    },

    flipCard(playerId, instanceId) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      const inst = player.instances[instanceId];
      if (!inst) return;
      snap();
      const faceUp = !inst.faceUp;
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances: {
                ...player.instances,
                [instanceId]: { ...inst, faceUp },
              },
            },
          },
          actionLog: [...s.state.actionLog, { type: "flipCard", playerId, instanceId, faceUp }],
        },
      }));
    },

    attachDon(playerId, instanceId, targetId) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      const inst = player.instances[instanceId];
      if (!inst) return;
      // Defensive: only a DON in the cost area may be given, and only to a card
      // currently on the board (leader/characterArea). Keeps replay/network-applied
      // actions from corrupting the model when the target moved in the meantime.
      if (targetId) {
        if (inst.cardId !== "DON" || !player.zones.donActive.includes(instanceId)) return;
        const target = player.instances[targetId];
        const onBoard =
          player.zones.leader.includes(targetId) ||
          player.zones.characterArea.includes(targetId);
        if (!target || !onBoard) return;
      }
      snap();
      const updated: CardInstance = { ...inst };
      if (targetId) updated.attachedTo = targetId;
      else delete updated.attachedTo;
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances: { ...player.instances, [instanceId]: updated },
            },
          },
          actionLog: [...s.state.actionLog, { type: "attachDon", playerId, instanceId, targetId }],
        },
      }));
    },

    refresh(playerId) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      snap();
      // Official refresh phase: return all given DON!!, stand every card, and
      // clear power markers (they mark temporary "+1000 until end of turn" boosts).
      const instances: Record<InstanceId, CardInstance> = {};
      for (const [iid, inst] of Object.entries(player.instances)) {
        const next: CardInstance = { ...inst, rested: false };
        delete next.attachedTo;
        delete next.marker;
        instances[iid] = next;
      }
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: { ...player, instances },
          },
          actionLog: [...s.state.actionLog, { type: "refresh", playerId }],
        },
      }));
    },

    setMarker(playerId, instanceId, delta) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      const inst = player.instances[instanceId];
      if (!inst) return;
      snap();
      const value = (inst.marker ?? 0) + delta;
      const updated: CardInstance = { ...inst };
      if (value === 0) delete updated.marker;
      else updated.marker = value;
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances: { ...player.instances, [instanceId]: updated },
            },
          },
          actionLog: [...s.state.actionLog, { type: "setMarker", playerId, instanceId, delta }],
        },
      }));
    },

    shuffleDeck(playerId) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      snap();
      const newDeck = shuffle([...player.zones.deck]);
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: { ...player, zones: { ...player.zones, deck: newDeck } },
          },
          actionLog: [...s.state.actionLog, { type: "shuffleDeck", playerId }],
        },
      }));
    },

    declareAttack(playerId, instanceId) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      const inst = player.instances[instanceId];
      if (!inst || inst.rested) return; // only active cards may attack
      // attackers must be on the board
      const onBoard =
        player.zones.leader.includes(instanceId) ||
        player.zones.characterArea.includes(instanceId);
      if (!onBoard) return;
      snap();
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances: {
                ...player.instances,
                [instanceId]: { ...inst, rested: true },
              },
            },
          },
          actionLog: [...s.state.actionLog, { type: "attack", playerId, instanceId }],
        },
      }));
    },

    rollDie(playerId, sides = 6) {
      // Pure log event: the outcome is decided HERE and recorded, so a replay
      // (or the opponent, later) sees exactly the same result.
      snap();
      const result = 1 + Math.floor(Math.random() * sides);
      set((s) => ({
        state: {
          ...s.state,
          actionLog: [...s.state.actionLog, { type: "dieRoll", playerId, sides, result }],
        },
      }));
    },

    nextTurn() {
      snap();
      set((s) => ({
        state: {
          ...s.state,
          turn: s.state.turn + 1,
          actionLog: [...s.state.actionLog, { type: "nextTurn", turn: s.state.turn + 1 }],
        },
      }));
    },

    beginTurn(playerId) {
      const { state } = get();
      if (!state.players[playerId]) return;
      snap();
      suppressHistory = true;
      try {
        const turn = get().state.turn;
        get().refresh(playerId);
        // The player who takes the very first turn of the game does not draw.
        if (turn > 1) get().drawCard(playerId, 1);
        // First turn places only 1 DON!!; every later turn places 2.
        get().drawDon(playerId, turn === 1 ? 1 : 2);
      } finally {
        suppressHistory = false;
      }
    },

    passTurn() {
      const { state } = get();
      if (!state.turnPlayerId) return;
      snap();
      suppressHistory = true;
      try {
        const order = state.playerOrder.length ? state.playerOrder : Object.keys(state.players);
        const i = Math.max(0, order.indexOf(state.turnPlayerId));
        const next = order.length ? order[(i + 1) % order.length] : state.turnPlayerId;
        const newTurn = state.turn + 1;
        set((s) => ({
          state: {
            ...s.state,
            turnPlayerId: next,
            turn: newTurn,
            actionLog: [...s.state.actionLog, { type: "nextTurn", turn: newTurn, turnPlayerId: next }],
          },
        }));
        // Automatic start-of-turn phases for the incoming seat (newTurn is always
        // ≥ 2 here, so this always draws 1 and places 2 DON!!).
        get().refresh(next);
        get().drawCard(next, 1);
        get().drawDon(next, 2);
      } finally {
        suppressHistory = false;
      }
    },

    mulligan(playerId) {
      const { state } = get();
      const player = state.players[playerId];
      if (!player) return;
      snap();
      // Official order is hand → mulligan decision → THEN deal life. Since setup
      // already dealt life, a faithful mulligan must return hand AND life to the
      // deck, reshuffle, draw a fresh 5 and re-deal the same number of life —
      // otherwise the original life cards stay locked out of the new hand's pool.
      const handIds = [...player.zones.hand];
      const lifeIds = [...player.zones.life];
      const lifeCount = lifeIds.length;
      const deck = shuffle([...player.zones.deck, ...handIds, ...lifeIds]);
      const instances = { ...player.instances };
      for (const iid of [...handIds, ...lifeIds]) {
        instances[iid] = { ...instances[iid], faceUp: false };
      }
      const newHandIds = deck.splice(0, 5);
      for (const iid of newHandIds) {
        instances[iid] = { ...instances[iid], faceUp: true };
      }
      const newLifeIds = deck.splice(0, lifeCount);
      set((s) => ({
        state: {
          ...s.state,
          players: {
            ...s.state.players,
            [playerId]: {
              ...player,
              instances,
              zones: { ...player.zones, hand: newHandIds, life: newLifeIds, deck },
            },
          },
          actionLog: [...s.state.actionLog, { type: "mulligan", playerId }],
        },
      }));
    },

    undo() {
      const past = get().past;
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ state: prev, past: past.slice(0, -1) });
    },

    resetGame() {
      set({ state: EMPTY_STATE, past: [] });
    },
  };
});

export function getSerializableState(): GameState {
  return useGameStore.getState().state;
}
