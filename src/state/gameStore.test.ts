import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore, type SetupInput } from "./gameStore";
import type { GameAction, InstanceId, PlayerState } from "./types";

/**
 * Unit tests for the serializable game core. The store is a singleton; each
 * test resets it and sets up a fresh practice game.
 */

const PID = "player-1";
const SETUP: SetupInput = {
  leaderId: "OP01-001",
  leaderLife: 5,
  main: [
    { cardId: "OP01-016", count: 30 },
    { cardId: "OP01-025", count: 20 },
  ], // 50 cards
};

const store = () => useGameStore.getState();
const player = (): PlayerState => store().state.players[PID];
const zone = (z: keyof PlayerState["zones"]) => player().zones[z];
const inst = (iid: InstanceId) => player().instances[iid];
const log = (): GameAction[] => store().state.actionLog;
const lastLog = () => log()[log().length - 1];

beforeEach(() => {
  store().resetGame();
  store().setup(PID, SETUP);
});

describe("setup", () => {
  it("deals the official opening state", () => {
    expect(zone("leader")).toHaveLength(1);
    expect(inst(zone("leader")[0]).faceUp).toBe(true);
    expect(zone("hand")).toHaveLength(5);
    for (const iid of zone("hand")) expect(inst(iid).faceUp).toBe(true);
    expect(zone("life")).toHaveLength(5);
    for (const iid of zone("life")) expect(inst(iid).faceUp).toBe(false);
    expect(zone("deck")).toHaveLength(50 - 5 - 5);
    expect(zone("donDeck")).toHaveLength(10);
    expect(zone("donActive")).toHaveLength(0);
    expect(zone("playArea")).toHaveLength(0);
    expect(store().state.turn).toBe(1);
    expect(lastLog().type).toBe("setup");
  });

  it("creates exactly 61 instances (50 main + leader + 10 DON)", () => {
    expect(Object.keys(player().instances)).toHaveLength(61);
  });
});

describe("draw", () => {
  it("drawCard moves top deck card to hand face-up and logs it", () => {
    const top = zone("deck")[0];
    store().drawCard(PID);
    expect(zone("deck")).toHaveLength(39);
    expect(zone("hand")).toHaveLength(6);
    expect(zone("hand")).toContain(top);
    expect(inst(top).faceUp).toBe(true);
    expect(lastLog()).toMatchObject({ type: "drawCard", playerId: PID, count: 1 });
  });

  it("drawDon moves a DON to the cost area face-up and logs it", () => {
    store().drawDon(PID);
    expect(zone("donDeck")).toHaveLength(9);
    expect(zone("donActive")).toHaveLength(1);
    expect(inst(zone("donActive")[0]).faceUp).toBe(true);
    expect(lastLog()).toMatchObject({ type: "drawDon", playerId: PID, count: 1 });
  });

  it("drawCard on an empty deck does not underflow", () => {
    store().drawCard(PID, 40);
    expect(zone("deck")).toHaveLength(0);
    const handSize = zone("hand").length;
    store().drawCard(PID); // deck empty
    expect(zone("hand")).toHaveLength(handSize);
  });
});

describe("moveCard", () => {
  it("hand → characterArea keeps the card face-up and logs from/to", () => {
    const iid = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: iid, from: "hand", to: "characterArea" });
    expect(zone("characterArea")).toContain(iid);
    expect(zone("hand")).not.toContain(iid);
    expect(lastLog()).toMatchObject({ type: "moveCard", from: "hand", to: "characterArea" });
  });

  it("auto-flips: → playArea face-up, → deck face-down, life → hand face-up", () => {
    const h = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: h, from: "hand", to: "playArea" });
    expect(inst(h).faceUp).toBe(true);

    store().moveCard({ playerId: PID, instanceId: h, from: "playArea", to: "deck", toIndex: 0 });
    expect(inst(h).faceUp).toBe(false);
    expect(zone("deck")[0]).toBe(h);

    const lifeTop = zone("life")[zone("life").length - 1];
    store().moveCard({ playerId: PID, instanceId: lifeTop, from: "life", to: "hand" });
    expect(inst(lifeTop).faceUp).toBe(true);
    expect(zone("life")).toHaveLength(4);
  });

  it("same-zone reorder (deck top/bottom) does not duplicate the card", () => {
    const sizeBefore = zone("deck").length;
    const someCard = zone("deck")[10];
    store().moveCard({ playerId: PID, instanceId: someCard, from: "deck", to: "deck", toIndex: 0 });
    expect(zone("deck")).toHaveLength(sizeBefore);
    expect(zone("deck")[0]).toBe(someCard);
    expect(zone("deck").filter((id) => id === someCard)).toHaveLength(1);

    store().moveCard({ playerId: PID, instanceId: someCard, from: "deck", to: "deck" });
    expect(zone("deck")).toHaveLength(sizeBefore);
    expect(zone("deck")[zone("deck").length - 1]).toBe(someCard);
  });

  it("a character leaving the board returns its attached DON and drops markers", () => {
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawDon(PID);
    const don = zone("donActive")[0];
    store().attachDon(PID, don, char);
    store().setMarker(PID, char, 1000);
    expect(inst(don).attachedTo).toBe(char);
    expect(inst(char).marker).toBe(1000);

    store().moveCard({ playerId: PID, instanceId: char, from: "characterArea", to: "trash" });
    expect(inst(don).attachedTo).toBeUndefined(); // DON returned to cost area
    expect(inst(char).marker).toBeUndefined();    // marker stripped in piles
  });
});

describe("attachDon", () => {
  it("attaches a cost-area DON to the leader and detaches with null", () => {
    store().drawDon(PID);
    const don = zone("donActive")[0];
    const leader = zone("leader")[0];
    store().attachDon(PID, don, leader);
    expect(inst(don).attachedTo).toBe(leader);
    expect(lastLog()).toMatchObject({ type: "attachDon", targetId: leader });

    store().attachDon(PID, don, null);
    expect(inst(don).attachedTo).toBeUndefined();
  });

  it("rejects invalid attachments (non-DON source, off-board target, DON still in donDeck)", () => {
    store().drawDon(PID);
    const don = zone("donActive")[0];
    const handCard = zone("hand")[0];
    const logSize = log().length;

    // target in hand (not on board) → rejected
    store().attachDon(PID, don, handCard);
    expect(inst(don).attachedTo).toBeUndefined();

    // non-DON source → rejected
    const leader = zone("leader")[0];
    store().attachDon(PID, handCard, leader);
    expect(inst(handCard).attachedTo).toBeUndefined();

    // DON still in the don deck → rejected
    const donInDeck = zone("donDeck")[0];
    store().attachDon(PID, donInDeck, leader);
    expect(inst(donInDeck).attachedTo).toBeUndefined();

    // none of the rejected calls may have produced log entries
    expect(log()).toHaveLength(logSize);
  });
});

describe("refresh / nextTurn", () => {
  it("returns DON, stands every card and clears markers, in one logged action", () => {
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawDon(PID);
    const don = zone("donActive")[0];
    const leader = zone("leader")[0];
    store().attachDon(PID, don, leader);
    store().restCard(PID, char, true);
    store().restCard(PID, leader, true);
    store().setMarker(PID, char, 2000);

    const logSize = log().length;
    store().refresh(PID);

    expect(inst(don).attachedTo).toBeUndefined();
    expect(inst(char).rested).toBe(false);
    expect(inst(leader).rested).toBe(false);
    expect(inst(char).marker).toBeUndefined();
    expect(log()).toHaveLength(logSize + 1);
    expect(lastLog()).toMatchObject({ type: "refresh", playerId: PID });
  });

  it("nextTurn increments the turn and logs it", () => {
    store().nextTurn();
    expect(store().state.turn).toBe(2);
    expect(lastLog()).toMatchObject({ type: "nextTurn", turn: 2 });
  });
});

describe("markers", () => {
  it("accumulates and removes itself at zero", () => {
    const leader = zone("leader")[0];
    store().setMarker(PID, leader, 1000);
    store().setMarker(PID, leader, 1000);
    expect(inst(leader).marker).toBe(2000);
    store().setMarker(PID, leader, -2000);
    expect(inst(leader).marker).toBeUndefined();
  });
});

describe("mulligan & shuffle", () => {
  it("mulligan redraws exactly 5 and keeps total counts intact", () => {
    const deckBefore = zone("deck").length;
    store().mulligan(PID);
    expect(zone("hand")).toHaveLength(5);
    expect(zone("deck")).toHaveLength(deckBefore);
    for (const iid of zone("hand")) expect(inst(iid).faceUp).toBe(true);
    expect(lastLog()).toMatchObject({ type: "mulligan", playerId: PID });
  });

  it("shuffleDeck keeps the same card set", () => {
    const before = [...zone("deck")].sort();
    store().shuffleDeck(PID);
    expect([...zone("deck")].sort()).toEqual(before);
    expect(lastLog()).toMatchObject({ type: "shuffleDeck", playerId: PID });
  });
});

describe("serializability (the non-negotiable rule)", () => {
  it("full state survives a JSON round-trip unchanged", () => {
    // dirty the state with every feature first
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawDon(PID);
    store().attachDon(PID, zone("donActive")[0], char);
    store().setMarker(PID, char, 1000);
    store().restCard(PID, char, true);

    const state = store().state;
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it("every action type that mutated state appears in the log", () => {
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawCard(PID);
    store().drawDon(PID);
    store().attachDon(PID, zone("donActive")[0], char);
    store().setMarker(PID, char, 1000);
    store().restCard(PID, char, true);
    store().flipCard(PID, char);
    store().refresh(PID);
    store().shuffleDeck(PID);
    store().mulligan(PID);
    store().nextTurn();

    const types = new Set(log().map((a) => a.type));
    for (const expected of [
      "setup", "moveCard", "drawCard", "drawDon", "attachDon", "setMarker",
      "restCard", "flipCard", "refresh", "shuffleDeck", "mulligan", "nextTurn",
    ]) {
      expect(types.has(expected as GameAction["type"]), `missing log for ${expected}`).toBe(true);
    }
  });
});
