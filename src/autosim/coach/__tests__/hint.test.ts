import { describe, expect, it } from "vitest";
import type { PlayerIntent } from "../../engine/intents";
import type { AutoGameState, EngineCard } from "../../engine/state";
import type { Thought } from "../../ai/pro";
import { buildHint } from "../hint";

const CARDS: Record<string, EngineCard> = {
  L1: { id: "L1", category: "Leader", cost: 5, power: 5000, counter: null, colors: ["Red"], types: [] },
  L2: { id: "L2", category: "Leader", cost: 5, power: 5000, counter: null, colors: ["Red"], types: [] },
  C3: { id: "C3", category: "Character", cost: 3, power: 4000, counter: 1000, colors: ["Red"], types: [] },
  C1: { id: "C1", category: "Character", cost: 1, power: 1000, counter: 1000, colors: ["Red"], types: [] },
};
const db = (id: string) => CARDS[id];

function base(): AutoGameState {
  return {
    seed: "s", rngUses: 0, order: ["p1", "p2"], turn: 3, turnPlayer: "p1", phase: "main",
    players: {
      p1: {
        id: "p1", leaderIid: "p1#0",
        zones: { deck: [], hand: ["p1#1"], trash: [], life: ["p1#2", "p1#3"], characterArea: ["p1#4"], stage: [] },
        instances: {
          "p1#0": { iid: "p1#0", cardId: "L1", rested: false },
          "p1#1": { iid: "p1#1", cardId: "C3", rested: false },
          "p1#2": { iid: "p1#2", cardId: "C1", rested: false },
          "p1#3": { iid: "p1#3", cardId: "C1", rested: false },
          "p1#4": { iid: "p1#4", cardId: "C1", rested: true },
        },
        don: { deck: 0, active: 5, rested: 0, given: {} },
        mulliganResolved: true,
      },
      p2: {
        id: "p2", leaderIid: "p2#0",
        zones: { deck: [], hand: [], trash: [], life: ["p2#1", "p2#2"], characterArea: [], stage: [] },
        instances: { "p2#0": { iid: "p2#0", cardId: "L2", rested: false }, "p2#1": { iid: "p2#1", cardId: "C1", rested: false }, "p2#2": { iid: "p2#2", cardId: "C1", rested: false } },
        don: { deck: 0, active: 0, rested: 0, given: {} },
        mulliganResolved: true,
      },
    },
    battle: null, modifiers: [], oncePerTurnUsed: {}, exec: null, pendingChoice: null, winner: null, winReason: null,
  };
}

const t = (intent: PlayerIntent, mean: number): Thought => ({ intent, mean, rollouts: 8 });
const play: PlayerIntent = { type: "playCard", player: "p1", iid: "p1#1" };
const attack: PlayerIntent = { type: "attack", player: "p1", attackerIid: "p1#0", targetIid: "p2#0" };

describe("buildHint", () => {
  it("returns null when the search produced no thoughts", () => {
    expect(buildHint(db, base(), "p1", [])).toBeNull();
  });

  it("names the card in the headline", () => {
    const h = buildHint(db, base(), "p1", [t(play, 40)]);
    expect(h?.headline).toBe("Cala C3");
    expect(h?.gerund).toBe("calando");
  });

  it("counts the DON!! the move leaves active", () => {
    const h = buildHint(db, base(), "p1", [t(play, 40)]);
    expect(h?.why).toContain("2 DON attivi");
  });

  it("prefers developing over attacking when attacking is the alternative", () => {
    const h = buildHint(db, base(), "p1", [t(play, 40), t(attack, 30)]);
    expect(h?.why).toContain("vale più che attaccare");
  });

  it("says the replacement victim out loud", () => {
    const over: PlayerIntent = { type: "playCard", player: "p1", iid: "p1#1", replaceIid: "p1#4" };
    const h = buildHint(db, base(), "p1", [t(over, 40)]);
    expect(h?.why).toContain("Sostituisce");
    expect(h?.marks.map((m) => m.role)).toEqual(["source", "victim"]);
  });

  it("measures the power margin on a Leader attack", () => {
    const s = base();
    s.players.p1.don.given = { "p1#0": 2 };
    const h = buildHint(db, s, "p1", [t(attack, 50)]);
    expect(h?.why).toContain("Margine di 2000");
    expect(h?.marks).toEqual([
      { owner: "p1", iid: "p1#0", role: "source" },
      { owner: "p2", iid: "p2#0", role: "target" },
    ]);
  });

  it("marks a Character kill as rested and explains it", () => {
    const s = base();
    s.players.p2.zones.characterArea = ["p2#1"];
    s.players.p2.instances["p2#1"].rested = true;
    const h = buildHint(db, s, "p1", [t({ type: "attack", player: "p1", attackerIid: "p1#0", targetIid: "p2#1" }, 50)]);
    expect(h?.why).toContain("non può bloccare");
    expect(h?.marks[1].owner).toBe("p2");
  });

  it("says nobody survives a block window with no blocker", () => {
    const s = base();
    s.battle = { attackerOwner: "p2", attackerIid: "p2#0", defenderOwner: "p1", targetIid: "p1#0", step: "block", blockerUsed: false, pendingDamage: 0 };
    const h = buildHint(db, s, "p1", [t({ type: "respondBlock", player: "p1", blockerIid: null }, 0)]);
    expect(h?.headline).toBe("Incassa il colpo");
    expect(h?.why).toContain("Nessun bloccante regge");
  });

  it("puts the alternative and both values in the note", () => {
    const h = buildHint(db, base(), "p1", [t(play, 40), t(attack, 30)]);
    expect(h?.note).toContain("In alternativa");
    expect(h?.note).toContain("su 10");
    expect(h?.altValue).toBe(30);
  });

  it("has no note when there was a single candidate", () => {
    expect(buildHint(db, base(), "p1", [t(play, 0)])?.note).toBeNull();
  });

  it("finds the owner of an opposing target", () => {
    const h = buildHint(db, base(), "p1", [t({ type: "respondTargets", player: "p1", iids: ["p2#1"] }, 10)]);
    expect(h?.headline).toBe("Bersaglia C1");
    expect(h?.marks).toEqual([{ owner: "p2", iid: "p2#1", role: "target" }]);
  });

  it("only says a single counter fails from a margin of 2000", () => {
    const give: PlayerIntent = { type: "giveDon", player: "p1", targetIid: "p1#0" };
    expect(buildHint(db, base(), "p1", [t(give, 10)])?.why).toContain("serve un counter da 2000");
    const s = base();
    s.players.p1.don.given = { "p1#0": 1 };
    expect(buildHint(db, s, "p1", [t(give, 10)])?.why).toContain("una sola carta di counter non basta più");
  });

  it("does not call a Character attack a kill when the power falls short", () => {
    const s = base();
    s.players.p2.instances["p2#1"] = { iid: "p2#1", cardId: "C3", rested: true };
    const h = buildHint(db, s, "p1", [t({ type: "attack", player: "p1", attackerIid: "p1#4", targetIid: "p2#1" }, 10)]);
    expect(h?.why).toBe("Non uccide C3: 1000 contro 4000, mancano 3000.");
  });

  describe("under attack", () => {
    /** p2's Leader swings at p1's, with `don` DON!! on it. */
    function attacked(don = 0, step: "block" | "counter" = "counter"): AutoGameState {
      const s = base();
      s.turnPlayer = "p2";
      s.players.p2.don.given = { "p2#0": don };
      s.battle = { attackerOwner: "p2", attackerIid: "p2#0", defenderOwner: "p1", targetIid: "p1#0", step, blockerUsed: false, pendingDamage: 0 };
      return s;
    }
    const counter: PlayerIntent = { type: "useCounter", player: "p1", cardIid: "p1#1", targetIid: "p1#0" };
    const pass: PlayerIntent = { type: "passCounter", player: "p1" };

    it("a counter that only ties does not stop the hit", () => {
      expect(buildHint(db, attacked(1), "p1", [t(counter, 0)])?.why).toContain("mancano ancora 1000");
    });

    it("a counter that goes over stops the hit", () => {
      expect(buildHint(db, attacked(), "p1", [t(counter, 0)])?.why).toContain("6000 contro 5000: il colpo non passa");
    });

    it("measures the pass against the counter in hand", () => {
      expect(buildHint(db, attacked(1), "p1", [t(pass, 0)])?.why).toContain("servono 2000 di counter, in mano ne hai 1000");
      expect(buildHint(db, attacked(), "p1", [t(pass, 0)])?.why).toContain("ma il bersaglio non vale le carte");
    });

    it("weighs the blockers actually available when taking the hit", () => {
      const s = attacked(0, "block");
      s.pendingChoice = { kind: "blockWindow", player: "p1", blockers: ["p1#4"] };
      const take: PlayerIntent = { type: "respondBlock", player: "p1", blockerIid: null };
      expect(buildHint(db, s, "p1", [t(take, 0)])?.why).toContain("il migliore è a 1000");
      s.players.p1.instances["p1#4"].cardId = "L1";
      s.players.p2.don.given = {};
      s.battle!.attackerIid = "p2#1";
      s.players.p2.zones.characterArea = ["p2#1"];
      expect(buildHint(db, s, "p1", [t(take, 0)])?.why).toContain("Un bloccante a 5000 reggerebbe 1000");
    });

    it("says what a losing block costs", () => {
      const block: PlayerIntent = { type: "respondBlock", player: "p1", blockerIid: "p1#4" };
      expect(buildHint(db, attacked(0, "block"), "p1", [t(block, 0)])?.why).toContain("perde il pezzo (costo 1)");
    });
  });

  it("counts the active DON!! when closing the turn", () => {
    const end: PlayerIntent = { type: "endTurn", player: "p1" };
    expect(buildHint(db, base(), "p1", [t(end, 0)])?.why).toContain("5 DON attivi");
    const s = base();
    s.players.p1.don.active = 0;
    expect(buildHint(db, s, "p1", [t(end, 0)])?.why).toContain("sono finiti");
  });
});