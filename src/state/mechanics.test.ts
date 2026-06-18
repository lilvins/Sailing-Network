import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore, type SetupInput } from "./gameStore";
import type { InstanceId, PlayerState } from "./types";

/**
 * MECHANICS CONFORMANCE — the official One Piece TCG flow, encoded as tests.
 * A MANUAL sim doesn't enforce rules, but every official gesture must be
 * POSSIBLE and behave like the real table. Spec per rule, then the check.
 *
 * Official references (comprehensive rules v1.x):
 *  - Setup: leader face-up, draw 5, ONE optional mulligan, THEN deal life
 *    equal to the leader's life value, face-down, from the top of the deck.
 *  - Turn: Refresh (return given DON!! to cost area + stand everything) →
 *    Draw 1 → DON!! phase (place up to 2 from DON!! deck, active) → Main
 *    (play cards by resting DON!!, give DON!! +1000, attack by resting the
 *    attacker; counters from hand during the counter step) → End.
 *  - Damage: winning attack on leader → opponent puts top life into hand
 *    (may reveal trigger first). Character KO → trash.
 *  - Limits the SIM may leave to the players: 5 characters, 1 stage,
 *    first-turn restrictions (no draw/1 DON for player one).
 */

const PID = "p1";
const SETUP: SetupInput = {
  leaderId: "OP01-001",
  leaderLife: 5,
  main: [{ cardId: "A", count: 25 }, { cardId: "B", count: 25 }],
};

const store = () => useGameStore.getState();
const player = (): PlayerState => store().state.players[PID];
const zone = (z: keyof PlayerState["zones"]) => player().zones[z];
const inst = (iid: InstanceId) => player().instances[iid];

beforeEach(() => {
  store().resetGame();
  store().setup(PID, SETUP);
});

describe("game setup (rule 5: prepare to play)", () => {
  it("leader starts face-up and standing in the leader area", () => {
    const l = inst(zone("leader")[0]);
    expect(l.faceUp).toBe(true);
    expect(l.rested).toBe(false);
  });

  it("life equals the leader's life value, dealt face-down from the deck", () => {
    expect(zone("life")).toHaveLength(SETUP.leaderLife);
    for (const iid of zone("life")) expect(inst(iid).faceUp).toBe(false);
  });

  it("DON!! deck holds exactly 10, all face-down", () => {
    expect(zone("donDeck")).toHaveLength(10);
    for (const iid of zone("donDeck")) expect(inst(iid).faceUp).toBe(false);
  });

  it("MULLIGAN: life must come from the post-mulligan deck (official order: hand → mulligan → life)", () => {
    const lifeBefore = [...zone("life")];
    store().mulligan(PID);
    const lifeAfter = [...zone("life")];
    // After a mulligan the original life cards must have re-entered the pool:
    // keeping the pre-mulligan life set means those 5 cards were unreachable
    // by the new hand, which deviates from the official sequence.
    expect(lifeAfter).toHaveLength(SETUP.leaderLife);
    const sameSet = lifeBefore.every((id) => lifeAfter.includes(id));
    expect(sameSet, "life cards were not re-dealt from the reshuffled deck").toBe(false);
    // counts must stay intact
    expect(zone("hand")).toHaveLength(5);
    expect(zone("deck")).toHaveLength(50 - 5 - SETUP.leaderLife);
  });
});

describe("turn structure", () => {
  it("DON!! phase: can place 2 DON!! at once, active, in the cost area", () => {
    store().drawDon(PID, 2);
    expect(zone("donActive")).toHaveLength(2);
    for (const iid of zone("donActive")) {
      expect(inst(iid).faceUp).toBe(true);
      expect(inst(iid).rested).toBe(false);
    }
    expect(zone("donDeck")).toHaveLength(8);
  });

  it("paying costs: a DON!! in the cost area can be rested", () => {
    store().drawDon(PID);
    const don = zone("donActive")[0];
    store().restCard(PID, don, true);
    expect(inst(don).rested).toBe(true);
  });

  it("give DON!!: attach to leader/character for +1000", () => {
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawDon(PID, 2);
    const [d1, d2] = zone("donActive");
    store().attachDon(PID, d1, zone("leader")[0]);
    store().attachDon(PID, d2, char);
    expect(inst(d1).attachedTo).toBe(zone("leader")[0]);
    expect(inst(d2).attachedTo).toBe(char);
  });

  it("REFRESH phase: given DON!! return active to cost area and everything stands", () => {
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawDon(PID, 2);
    const [d1, d2] = zone("donActive");
    store().attachDon(PID, d1, char);
    store().restCard(PID, d2, true);       // spent paying a cost
    store().restCard(PID, char, true);     // attacked
    store().refresh(PID);
    expect(inst(d1).attachedTo).toBeUndefined();
    expect(inst(d1).rested).toBe(false);
    expect(inst(d2).rested).toBe(false);
    expect(inst(char).rested).toBe(false);
    expect(zone("donActive")).toHaveLength(2); // still in cost area
  });
});

describe("battle gestures", () => {
  it("declareAttack: the attacker rests and the attack is logged", () => {
    const leader = zone("leader")[0];
    store().declareAttack(PID, leader);
    expect(inst(leader).rested).toBe(true);
    const log = store().state.actionLog;
    expect(log[log.length - 1]).toMatchObject({ type: "attack", playerId: PID, instanceId: leader });
  });

  it("declareAttack rejects rested attackers and cards not on the board", () => {
    const leader = zone("leader")[0];
    store().declareAttack(PID, leader);
    const logSize = store().state.actionLog.length;
    store().declareAttack(PID, leader); // already rested → no-op
    expect(store().state.actionLog).toHaveLength(logSize);
    const handCard = zone("hand")[0];
    store().declareAttack(PID, handCard); // in hand → no-op
    expect(inst(handCard).rested).toBe(false);
    expect(store().state.actionLog).toHaveLength(logSize);
  });

  it("counter step: a counter from hand can be shown in the play area then trashed", () => {
    const counter = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: counter, from: "hand", to: "playArea" });
    expect(inst(counter).faceUp).toBe(true);
    store().moveCard({ playerId: PID, instanceId: counter, from: "playArea", to: "trash" });
    expect(zone("trash")).toContain(counter);
  });

  it("taking damage: top life can be revealed (trigger) and then added to hand", () => {
    const top = zone("life")[zone("life").length - 1];
    // trigger reveal: life → play area, face-up
    store().moveCard({ playerId: PID, instanceId: top, from: "life", to: "playArea" });
    expect(inst(top).faceUp).toBe(true);
    // no trigger used → into hand
    store().moveCard({ playerId: PID, instanceId: top, from: "playArea", to: "hand" });
    expect(zone("hand")).toContain(top);
    expect(zone("life")).toHaveLength(SETUP.leaderLife - 1);
  });

  it("KO: a character goes to the trash and releases its DON!!", () => {
    const char = zone("hand")[0];
    store().moveCard({ playerId: PID, instanceId: char, from: "hand", to: "characterArea" });
    store().drawDon(PID);
    const don = zone("donActive")[0];
    store().attachDon(PID, don, char);
    store().moveCard({ playerId: PID, instanceId: char, from: "characterArea", to: "trash" });
    expect(zone("trash")).toContain(char);
    expect(inst(don).attachedTo).toBeUndefined();
  });
});

describe("table utilities", () => {
  it("coin flip / die roll logs the RESULT (replay-safe randomness)", () => {
    store().rollDie(PID, 2);
    store().rollDie(PID, 6);
    const log = store().state.actionLog;
    const rolls = log.filter((a) => a.type === "dieRoll");
    expect(rolls).toHaveLength(2);
    const [coin, d6] = rolls as Extract<typeof log[number], { type: "dieRoll" }>[];
    expect(coin.sides).toBe(2);
    expect(coin.result === 1 || coin.result === 2).toBe(true);
    expect(d6.sides).toBe(6);
    expect(d6.result).toBeGreaterThanOrEqual(1);
    expect(d6.result).toBeLessThanOrEqual(6);
    // pure log event: no zone/instance changes
    expect(zone("hand")).toHaveLength(5);
  });
});

describe("deliberate manual-sim freedoms (documented decisions)", () => {
  it("does NOT hard-block a 6th character — table rules are the players' job", () => {
    for (let i = 0; i < 5; i++) store().drawCard(PID);
    const six = zone("hand").slice(0, 6);
    for (const iid of six) {
      store().moveCard({ playerId: PID, instanceId: iid, from: "hand", to: "characterArea" });
    }
    expect(zone("characterArea")).toHaveLength(6); // allowed by design
  });

  it("first-turn restrictions (no draw / 1 DON) are not enforced — manual", () => {
    // turn 1: the sim still allows drawing — players follow the rule themselves
    store().drawCard(PID);
    expect(zone("hand")).toHaveLength(6);
  });
});
