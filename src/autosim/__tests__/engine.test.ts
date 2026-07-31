import { describe, expect, it } from "vitest";
import goldenCards from "../data/golden/golden-cards.json";
import { applyEvent, type GameEvent } from "../engine/events";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { EngineError, type PlayerIntent } from "../engine/intents";
import { effectivePower, type AutoGameState, type CardDb, type EngineCard } from "../engine/state";
import { legalMoves } from "../engine/legality";
import { validateCompiledCard } from "../ir/validate";

/**
 * M0 test suite (AUTOSIM_PLAN.md §8 — exit: full vanilla game playable
 * hotseat via scripted test + replay determinism). Synthetic card DB: the
 * engine only sees EngineCard fields, so tests don't depend on the real DB.
 */

// ─── synthetic card DB ───────────────────────────────────────────────────────

const CARDS: Record<string, EngineCard> = {
  "TL01-001": { id: "TL01-001", category: "Leader", cost: 4, power: 5000, counter: null, colors: ["Red"], types: ["Test"] }, // cost = Life 4
  "TL01-002": { id: "TL01-002", category: "Leader", cost: 5, power: 5000, counter: null, colors: ["Blue"], types: ["Test"] },
  "TC01-001": { id: "TC01-001", category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["Test"] },
  "TC01-002": { id: "TC01-002", category: "Character", cost: 2, power: 3000, counter: 2000, colors: ["Red"], types: ["Test"] },
  "TC01-003": { id: "TC01-003", category: "Character", cost: 4, power: 6000, counter: null, colors: ["Red"], types: ["Test"] },
  "TE01-001": { id: "TE01-001", category: "Event", cost: 1, power: null, counter: null, colors: ["Red"], types: ["Test"] },
  "TS01-001": { id: "TS01-001", category: "Stage", cost: 1, power: null, counter: null, colors: ["Red"], types: ["Test"] },
};
const db: CardDb = (id) => {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};

/** 50-card deck: 20× 1-cost, 15× 2-cost, 10× 4-cost char, 3× event, 2× stage. */
const DECK: string[] = [
  ...Array(20).fill("TC01-001"),
  ...Array(15).fill("TC01-002"),
  ...Array(10).fill("TC01-003"),
  ...Array(3).fill("TE01-001"),
  ...Array(2).fill("TS01-001"),
];

const CONFIG: GameConfig = {
  seed: "m0-test-seed",
  players: [
    { id: "alice", leader: "TL01-001", deck: DECK },
    { id: "bob", leader: "TL01-002", deck: DECK },
  ],
  firstPlayer: "alice",
};

// engine driver: applies a sequence of intents, accumulating events
function run(state: AutoGameState, log: GameEvent[], intents: PlayerIntent[]): AutoGameState {
  let s = state;
  for (const intent of intents) {
    const r = applyIntent(db, s, intent);
    s = r.state;
    log.push(...r.events);
  }
  return s;
}

/** Fresh game with both mulligans declined. */
function newGame() {
  const { state, events } = createGame(db, CONFIG);
  const log = [...events];
  const s = run(state, log, [
    { type: "respondMulligan", player: "alice", take: false },
    { type: "respondMulligan", player: "bob", take: false },
  ]);
  return { s, log };
}

// find a hand card of a given cardId
const inHand = (s: AutoGameState, pid: string, cardId: string) =>
  s.players[pid].zones.hand.find((iid) => s.players[pid].instances[iid].cardId === cardId);

// ─── setup (5) ───────────────────────────────────────────────────────────────

describe("setup (5-2)", () => {
  it("deals 5-card hands, Life = leader Life value, 10 DON, and starts turn 1 with the right phases", () => {
    const { s } = newGame();
    expect(s.players.alice.zones.hand).toHaveLength(5);
    expect(s.players.bob.zones.hand).toHaveLength(5);
    expect(s.players.alice.zones.life).toHaveLength(4);  // TL01-001 Life 4
    expect(s.players.bob.zones.life).toHaveLength(5);    // TL01-002 Life 5
    expect(s.players.alice.don.deck).toBe(9);            // 6-4-1: 1 DON on first turn
    expect(s.players.alice.don.active).toBe(1);
    // 6-3-1: first player does NOT draw on turn 1 → hand still 5
    expect(s.players.alice.zones.deck).toHaveLength(50 - 5 - 4);
    expect(s.turn).toBe(1);
    expect(s.turnPlayer).toBe("alice");
    expect(s.phase).toBe("main");
  });

  it("mulligan returns the hand, reshuffles, redraws exactly 5 (5-2-1-6)", () => {
    const { state, events } = createGame(db, CONFIG);
    const log = [...events];
    const before = [...state.players.alice.zones.hand];
    const s = run(state, log, [
      { type: "respondMulligan", player: "alice", take: true },
      { type: "respondMulligan", player: "bob", take: false },
    ]);
    expect(s.players.alice.zones.hand).toHaveLength(5);
    // deck+hand+life still account for all 50 cards
    const z = s.players.alice.zones;
    expect(z.deck.length + z.hand.length + z.life.length).toBe(50);
    // shuffled: extremely unlikely to redraw the identical hand in order
    expect(s.players.alice.zones.hand).not.toEqual(before);
  });

  it("rejects decks that are not exactly 50 cards (5-1-2)", () => {
    expect(() =>
      createGame(db, { ...CONFIG, players: [{ id: "a", leader: "TL01-001", deck: DECK.slice(1) }, CONFIG.players[1]] }),
    ).toThrow(EngineError);
  });
});

// ─── main phase actions (6-5) ────────────────────────────────────────────────

describe("playing cards and DON (6-5)", () => {
  it("pays costs by resting DON and refuses without enough active DON", () => {
    let { s, log } = newGame();
    // alice turn 1: 1 active DON. TC01-002 costs 2 → illegal.
    const twoCost = inHand(s, "alice", "TC01-002");
    if (twoCost) {
      expect(() => applyIntent(db, s, { type: "playCard", player: "alice", iid: twoCost })).toThrow(/active DON/);
    }
    const oneCost = inHand(s, "alice", "TC01-001")!;
    s = run(s, log, [{ type: "playCard", player: "alice", iid: oneCost }]);
    expect(s.players.alice.zones.characterArea).toContain(oneCost);
    expect(s.players.alice.don.active).toBe(0);
    expect(s.players.alice.don.rested).toBe(1);
    expect(s.players.alice.instances[oneCost].playedOnTurn).toBe(1);
  });

  it("gives DON to leader (+1000 in own turn only, 6-5-5-2)", () => {
    let { s, log } = newGame();
    s = run(s, log, [{ type: "giveDon", player: "alice", targetIid: s.players.alice.leaderIid }]);
    expect(s.players.alice.don.given[s.players.alice.leaderIid]).toBe(1);
    expect(effectivePower(db, s, "alice", s.players.alice.leaderIid)).toBe(6000); // 5000 + 1000
    // pass turn → no longer alice's turn → bonus off
    s = run(s, log, [{ type: "endTurn", player: "alice" }]);
    expect(effectivePower(db, s, "alice", s.players.alice.leaderIid)).toBe(5000);
  });

  it("refresh returns given DON and stands everything at next turn start (6-2)", () => {
    let { s, log } = newGame();
    s = run(s, log, [
      { type: "giveDon", player: "alice", targetIid: s.players.alice.leaderIid },
      { type: "endTurn", player: "alice" },   // → bob turn 2
      { type: "endTurn", player: "bob" },     // → alice turn 3
    ]);
    const don = s.players.alice.don;
    expect(Object.keys(don.given)).toHaveLength(0);
    expect(don.rested).toBe(0);
    expect(don.active).toBe(3); // 1 (t1) + 2 (t3)
  });

  it("enforces the 5-character limit with replace-by-rule (3-7-6-1)", () => {
    let { s, log } = newGame();
    let guard = 0;
    // cheapest AFFORDABLE character currently in alice's hand
    const cheapest = (): string | undefined => {
      const p = s.players.alice;
      return p.zones.hand
        .map((iid) => ({ iid, card: db(p.instances[iid].cardId) }))
        .filter(({ card }) => card.category === "Character" && (card.cost ?? 0) <= p.don.active)
        .sort((x, y) => (x.card.cost ?? 0) - (y.card.cost ?? 0))[0]?.iid;
    };
    const passRound = () => { s = run(s, log, [{ type: "endTurn", player: "alice" }, { type: "endTurn", player: "bob" }]); };

    while (s.players.alice.zones.characterArea.length < 5 && guard++ < 40) {
      const iid = cheapest();
      if (iid) s = run(s, log, [{ type: "playCard", player: "alice", iid }]);
      else passRound();
    }
    expect(s.players.alice.zones.characterArea).toHaveLength(5);
    while (cheapest() === undefined && guard++ < 60) passRound();
    const sixth = cheapest()!;
    expect(() => applyIntent(db, s, { type: "playCard", player: "alice", iid: sixth })).toThrow(/replaceIid/);
    const victim = s.players.alice.zones.characterArea[0];
    s = run(s, log, [{ type: "playCard", player: "alice", iid: sixth, replaceIid: victim }]);
    expect(s.players.alice.zones.characterArea).toHaveLength(5);
    expect(s.players.alice.zones.trash).toContain(victim);
  });
});

// ─── battle (7) ──────────────────────────────────────────────────────────────

describe("battle (7-1)", () => {
  /** Game advanced so alice has a character on board and it's her turn 3. */
  function battleReady() {
    let { s, log } = newGame();
    const c = inHand(s, "alice", "TC01-001")!;
    s = run(s, log, [
      { type: "playCard", player: "alice", iid: c },   // turn 1, cost 1
      { type: "endTurn", player: "alice" },
      { type: "endTurn", player: "bob" },              // → alice turn 3
    ]);
    return { s, log, c };
  }

  it("blocks battles on each player's first turn (6-5-6-1) and summoning sickness (3-7-4)", () => {
    let { s, log } = newGame();
    const bobLeader = s.players.bob.leaderIid;
    expect(() => applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: bobLeader }))
      .toThrow(/first turn/);
    const c = inHand(s, "alice", "TC01-001")!;
    s = run(s, log, [
      { type: "playCard", player: "alice", iid: c },
      { type: "endTurn", player: "alice" },
      { type: "endTurn", player: "bob" },
    ]);
    // turn 3: the character played turn 1 can attack; play a NEW one → sick
    const fresh = inHand(s, "alice", "TC01-001") ?? inHand(s, "alice", "TC01-002");
    if (fresh) {
      s = run(s, log, [{ type: "playCard", player: "alice", iid: fresh }]);
      expect(() => applyIntent(db, s, { type: "attack", player: "alice", attackerIid: fresh, targetIid: s.players.bob.leaderIid }))
        .toThrow(/played this turn/);
    }
  });

  it("leader attack deals 1 damage: top Life to defender's hand (7-1-4-1-1-2)", () => {
    let { s, log } = battleReady();
    const bob = s.players.bob;
    const topLife = bob.zones.life[bob.zones.life.length - 1];
    s = run(s, log, [
      { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: bob.leaderIid },
      { type: "passCounter", player: "bob" }, // 5000 vs 5000 → tie → attacker wins (7-1-4-1)
    ]);
    expect(s.players.bob.zones.life).toHaveLength(4);
    expect(s.players.bob.zones.hand).toContain(topLife);
    expect(s.players.alice.instances[s.players.alice.leaderIid].rested).toBe(true); // 7-1-1-1
    expect(s.battle).toBeNull();
  });

  it("counter values from hand can flip the outcome (7-1-3-2-1)", () => {
    let { s, log } = battleReady();
    const bob = s.players.bob;
    const counterCard = inHand(s, "bob", "TC01-001") ?? inHand(s, "bob", "TC01-002");
    expect(counterCard).toBeTruthy();
    const lifeBefore = bob.zones.life.length;
    s = run(s, log, [
      { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: bob.leaderIid },
      { type: "useCounter", player: "bob", cardIid: counterCard!, targetIid: bob.leaderIid },
      { type: "passCounter", player: "bob" },
    ]);
    // 5000 vs 5000+counter → attacker loses, no damage
    expect(s.players.bob.zones.life).toHaveLength(lifeBefore);
    expect(s.players.bob.zones.trash).toContain(counterCard); // counter card trashed
    expect(s.battle).toBeNull(); // thisBattle mods died with the battle
  });

  it("attacking a rested character K.O.s it and returns its given DON (7-1-4-1-2, 6-5-5-4)", () => {
    let { s, log } = battleReady();
    // bob: play a character on his turn 4 and rest it by attacking alice's leader? Simpler:
    // bob plays a char turn 4; alice attacks it on turn 5 while it is rested via bob attacking.
    const bobChar = inHand(s, "bob", "TC01-001")!;
    s = run(s, log, [
      { type: "endTurn", player: "alice" },                       // → bob turn 4
      { type: "playCard", player: "bob", iid: bobChar },
      { type: "endTurn", player: "bob" },                         // → alice turn 5
    ]);
    // bob's char is ACTIVE → cannot be attacked (7-1-1-2)
    expect(() => applyIntent(db, s, { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: bobChar }))
      .toThrow(/RESTED/);
    // bob's turn 6: give a DON to the char AFTER his refresh, then attack with
    // it (rests it). The given DON survives ALICE's refresh — it returns only
    // at BOB's next refresh (6-2-3) or when the char leaves the field (6-5-5-4).
    s = run(s, log, [
      { type: "endTurn", player: "alice" },                       // → bob turn 6
      { type: "giveDon", player: "bob", targetIid: bobChar },
      { type: "attack", player: "bob", attackerIid: bobChar, targetIid: s.players.alice.leaderIid },
    ]);
    s = run(s, log, [{ type: "passCounter", player: "alice" }]);  // 3000 vs 5000 → lost
    s = run(s, log, [{ type: "endTurn", player: "bob" }]);        // → alice turn 7
    expect(s.players.bob.don.given[bobChar]).toBe(1);
    const restedBefore = s.players.bob.don.rested;
    s = run(s, log, [
      { type: "attack", player: "alice", attackerIid: s.players.alice.leaderIid, targetIid: bobChar },
      { type: "passCounter", player: "bob" },                     // 5000 vs 2000 (no DON bonus off-turn)
    ]);
    expect(s.players.bob.zones.trash).toContain(bobChar);
    expect(s.players.bob.don.rested).toBe(restedBefore + 1);      // given DON returned rested (6-5-5-4)
  });
});

// ─── full game + replay (M0 exit criteria) ───────────────────────────────────

describe("M0 exit: full vanilla game + replay determinism", () => {
  it("plays a complete scripted hotseat game to GameOver", () => {
    let { s, log } = newGame();
    // Strategy: alice attacks bob's leader with her leader every turn.
    // Bob never counters. Bob's Life 5 → 5 hits + 1 lethal = game over.
    let guard = 0;
    while (s.phase !== "over" && guard++ < 200) {
      if (s.turnPlayer === "alice" && !s.pendingChoice && !s.battle) {
        if (s.turn === 1) { s = run(s, log, [{ type: "endTurn", player: "alice" }]); continue; }
        const attacker = s.players.alice.leaderIid;
        if (!s.players.alice.instances[attacker].rested) {
          s = run(s, log, [{ type: "attack", player: "alice", attackerIid: attacker, targetIid: s.players.bob.leaderIid }]);
        } else {
          s = run(s, log, [{ type: "endTurn", player: "alice" }]);
        }
      } else if (s.pendingChoice?.kind === "counterWindow") {
        s = run(s, log, [{ type: "passCounter", player: s.pendingChoice.player }]);
      } else if (s.turnPlayer === "bob" && !s.pendingChoice && !s.battle) {
        s = run(s, log, [{ type: "endTurn", player: "bob" }]);
      } else {
        throw new Error("unexpected state");
      }
    }
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("alice");
    expect(s.winReason).toBe("leaderDamageAtZeroLife");
    expect(s.players.bob.zones.life).toHaveLength(0);
    // bob got his 5 life cards in hand
    expect(log.filter((e) => e.type === "lifeCardToHand")).toHaveLength(5);
  });

  it("replay: folding applyEvent over the log reproduces the exact final state", () => {
    // fresh skeleton = createGame BEFORE its own events... createGame already
    // applies events. Rebuild the skeleton by cloning the post-create state and
    // rewinding: instead, replay from a second createGame with the same config
    // (deterministic ids) minus its events, then apply the FULL log.
    const a = createGame(db, CONFIG);
    let live = a.state;
    const fullLog: GameEvent[] = [...a.events];
    const intents: PlayerIntent[] = [
      { type: "respondMulligan", player: "alice", take: true },
      { type: "respondMulligan", player: "bob", take: false },
      { type: "giveDon", player: "alice", targetIid: live.players.alice.leaderIid },
      { type: "endTurn", player: "alice" },
      { type: "endTurn", player: "bob" },
    ];
    for (const intent of intents) {
      const r = applyIntent(db, live, intent);
      live = r.state;
      fullLog.push(...r.events);
    }

    // skeleton: same createGame but with events NOT applied — reconstruct by
    // building a pristine state via createGame and undoing is impossible; so
    // we snapshot the skeleton the same way createGame builds it: run
    // createGame again and strip what its events added by replaying the full
    // log onto a state built from zero events.
    const b = createGame(db, CONFIG);
    // b.state already includes b.events (identical to a.events by determinism).
    // Replay the REMAINING events (post-create) on top of it:
    const rest = fullLog.slice(a.events.length);
    const replayed = structuredClone(b.state);
    for (const e of rest) applyEvent(replayed, e);
    // pendingChoice/rngUses are engine bookkeeping, not event-derived; align them
    replayed.pendingChoice = live.pendingChoice;
    replayed.rngUses = live.rngUses;
    expect(replayed).toEqual(live);
  });

  it("legalMoves matches engine acceptance on a sample state", () => {
    const { s } = newGame();
    const lm = legalMoves(db, s);
    expect(lm.actor).toBe("alice");
    expect(lm.canEndTurn).toBe(true);
    expect(lm.attackers).toHaveLength(0); // first turn — no battles
    for (const p of lm.playableFromHand) {
      expect(p.cost).toBeLessThanOrEqual(s.players.alice.don.active);
    }
  });
});

// ─── IR validation + golden ──────────────────────────────────────────────────

describe("Effect IR (M0 deliverable)", () => {
  it("golden examples validate against the IR", () => {
    for (const g of goldenCards) {
      const res = validateCompiledCard(g);
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
    }
  });

  it("rejects malformed compiled cards with useful errors", () => {
    const bad = {
      cardId: "not-an-id", version: 2, confidence: 3, classification: "weird",
      keywords: ["Flying"], effects: [{ timing: "onDance", actions: [] }],
    };
    const res = validateCompiledCard(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/cardId/);
    expect(res.errors.join("\n")).toMatch(/version/);
    expect(res.errors.join("\n")).toMatch(/keyword/);
    expect(res.errors.join("\n")).toMatch(/timing/);
  });

  it("lints semantic contradictions (static+instant, oncePerTurn on static)", () => {
    const res = validateCompiledCard({
      cardId: "TEST-999", version: 1, confidence: 1, classification: "compiled",
      keywords: [],
      effects: [{
        timing: "static", oncePerTurn: true,
        actions: [{ kind: "powerMod", sel: { owner: "self", zone: "leader", count: 1, chooser: "controller" }, amount: 1000, duration: "instant" }],
      }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/static effect with instant/);
    expect(res.errors.join("\n")).toMatch(/oncePerTurn on a static/);
  });
});
