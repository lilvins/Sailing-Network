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
  turnPlayerId: "",
  turn: 0,
  actionLog: [],
};

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

export interface GameStore {
  state: GameState;
  setup: (playerId: string, input: SetupInput) => void;
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
  nextTurn: () => void;
  mulligan: (playerId: string) => void;
  resetGame: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: EMPTY_STATE,

  setup(playerId, input) {
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

    const decklist: Decklist = {
      leader: input.leaderId,
      main: input.main,
      don: 10,
    };

    set((s) => ({
      state: {
        ...s.state,
        players: { ...s.state.players, [playerId]: player },
        turnPlayerId: playerId,
        turn: 1,
        actionLog: [...s.state.actionLog, { type: "setup", playerId, deck: decklist }],
      },
    }));
  },

  drawCard(playerId, count = 1) {
    const { state } = get();
    const player = state.players[playerId];
    if (!player) return;
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
      // Markers don't follow cards into piles/hand
      if (to === "hand" || to === "deck" || to === "trash" || to === "life" || to === "donDeck") {
        delete updated.marker;
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
    const result = 1 + Math.floor(Math.random() * sides);
    set((s) => ({
      state: {
        ...s.state,
        actionLog: [...s.state.actionLog, { type: "dieRoll", playerId, sides, result }],
      },
    }));
  },

  nextTurn() {
    set((s) => ({
      state: {
        ...s.state,
        turn: s.state.turn + 1,
        actionLog: [...s.state.actionLog, { type: "nextTurn", turn: s.state.turn + 1 }],
      },
    }));
  },

  mulligan(playerId) {
    const { state } = get();
    const player = state.players[playerId];
    if (!player) return;
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

  resetGame() {
    set({ state: EMPTY_STATE });
  },
}));

export function getSerializableState(): GameState {
  return useGameStore.getState().state;
}
