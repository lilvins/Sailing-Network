import { describe, expect, it } from "vitest";
import type { CostItem, Selector } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { canPayCost } from "../engine/effects";
import type { AutoGameState, CardDb, EngineCard, PID } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/**
 * M5 costs: any action done in full can be a cost (`{ kind: "action" }`):
 * K.O. / trash / bottom-deck one of your own cards, "place N cards from your
 * trash at the bottom of your deck", mill, reveal from hand, give active DON.
 * 8-3-1-3: a cost that can't be paid in full blocks the activation.
 */

const CARDS: Record<string, EngineCard> = {};
const sel = (zone: Selector["zone"], count: number, extra: Partial<Selector> = {}): Selector =>
  ({ owner: "self", zone, count, chooser: "controller", ...extra });

function addCard(id: string, cost: CostItem[] | null, o: Partial<EngineCard> = {}): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    compiled: cost ? {
      cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [],
      effects: [{ timing: "activateMain", cost, actions: [{ kind: "draw", count: 1 }] }],
    } : undefined,
  } as EngineCard;
}
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("C-KO", [{ kind: "action", action: { kind: "koTarget", sel: sel("characterArea", 1, { filter: { excludeSelf: true } }) } }]);
addCard("C-TRASH", [{ kind: "action", action: { kind: "trashTarget", sel: sel("characterArea", 1, { filter: { excludeSelf: true } }) } }]);
addCard("C-BOTTOM", [{ kind: "action", action: { kind: "returnToDeck", sel: sel("trash", 2), where: "bottom" } }]);
addCard("C-MILL", [{ kind: "action", action: { kind: "mill", who: "self", count: 2 } }]);
addCard("C-REVEAL", [{ kind: "action", action: { kind: "reveal", sel: sel("hand", 1, { filter: { category: ["Event"] } }) } }]);
addCard("C-SELFBOTTOM", [{ kind: "action", action: { kind: "returnToDeck", sel: sel("characterArea", 1, { self: true }), where: "bottom" } }]);
addCard("E-1", null, { category: "Event" });
for (let i = 1; i <= 7; i++) addCard(`V${i}`, null);

const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const DECK = ["C-KO", "C-TRASH", "C-BOTTOM", "C-MILL", "C-REVEAL", "C-SELFBOTTOM", "V1", "V2", "V3", "V4", "V5", "V6"]
  .flatMap((id) => Array<string>(4).fill(id)).concat("E-1", "V7");

function newGame(): AutoGameState {
  const config: GameConfig = {
    seed: "m5costs", firstPlayer: "alice",
    players: [{ id: "alice", leader: "L", deck: DECK }, { id: "bob", leader: "L", deck: DECK }],
  };
  let s = createGame(db, config).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
  s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
  return s;
}

/** Move a copy of `cardId` from deck/hand to `zone` (test setup). */
function put(s: AutoGameState, cardId: string, zone: "characterArea" | "trash" | "hand" = "characterArea", pid: PID = "alice"): string {
  const p = s.players[pid];
  for (const from of ["deck", "hand"] as const) {
    const i = p.zones[from].findIndex((iid) => p.instances[iid].cardId === cardId);
    if (i >= 0) {
      const [iid] = p.zones[from].splice(i, 1);
      p.zones[zone].push(iid);
      return iid;
    }
  }
  throw new Error(`no ${cardId} left`);
}

const activate = (s: AutoGameState, iid: string) => applyIntent(db, s, { type: "activateMain", player: "alice", iid, effectIndex: 0 });
const costOf = (id: string) => CARDS[id].compiled!.effects[0].cost;

describe("M5 action costs", () => {
  it("K.O. one of your Characters: unpayable alone, a choice with two, then the payoff", () => {
    let s = newGame();
    const ko = put(s, "C-KO");
    expect(canPayCost(db, s, "alice", ko, costOf("C-KO"))).toBe(false);
    expect(() => activate(s, ko)).toThrow();
    const a = put(s, "V1"), b = put(s, "V2");
    expect(canPayCost(db, s, "alice", ko, costOf("C-KO"))).toBe(true);
    const hand = s.players.alice.zones.hand.length;
    s = activate(s, ko).state;
    expect(s.pendingChoice?.kind).toBe("selectTargets");
    s = applyIntent(db, s, { type: "respondTargets", player: "alice", iids: [b] }).state;
    expect(s.players.alice.zones.trash).toContain(b);
    expect(s.players.alice.zones.characterArea).toContain(a);
    expect(s.players.alice.zones.hand.length).toBe(hand + 1);
  });

  it("trash a Character (not a K.O.) is paid automatically when there is one choice", () => {
    let s = newGame();
    const t = put(s, "C-TRASH");
    const v = put(s, "V1");
    s = activate(s, t).state;
    expect(s.pendingChoice).toBeNull();
    expect(s.players.alice.zones.trash).toContain(v);
  });

  it("place 2 cards from your trash at the bottom of your deck", () => {
    let s = newGame();
    const c = put(s, "C-BOTTOM");
    const x = put(s, "V1", "trash");
    expect(canPayCost(db, s, "alice", c, costOf("C-BOTTOM"))).toBe(false);
    const y = put(s, "V2", "trash");
    s = activate(s, c).state;
    const deck = s.players.alice.zones.deck;
    expect(deck.slice(-2).sort()).toEqual([x, y].sort());
    expect(s.players.alice.zones.trash).not.toContain(x);
  });

  it("mill 2, reveal an Event from the hand, place this Character at the bottom", () => {
    let s = newGame();
    const m = put(s, "C-MILL");
    const deckBefore = s.players.alice.zones.deck.length;
    s = activate(s, m).state;
    expect(s.players.alice.zones.deck.length).toBe(deckBefore - 2 - 1); // 2 milled, 1 drawn

    const r = put(s, "C-REVEAL");
    const al = s.players.alice;
    al.zones.hand = al.zones.hand.filter((iid) => al.instances[iid].cardId !== "E-1" || (al.zones.deck.unshift(iid), false));
    expect(canPayCost(db, s, "alice", r, costOf("C-REVEAL"))).toBe(false);
    const ev = put(s, "E-1", "hand");
    const res = activate(s, r);
    expect(res.events.some((e) => e.type === "cardsRevealed")).toBe(true);
    s = res.state;
    expect(s.players.alice.zones.hand).toContain(ev); // revealing does not move it

    const sb = put(s, "C-SELFBOTTOM");
    s = activate(s, sb).state;
    expect(s.players.alice.zones.deck.at(-1)).toBe(sb);
  });
});

describe("M5 compiler: costs from optcg-ai", () => {
  const costsOf = (id: string) => getGeneratedCard(id)!.effects.filter((fx) => fx.cost).map((fx) => ({ cost: fx.cost, actions: fx.actions.map((x) => x.kind) }));

  it("\"place 3 {CP} cards from your trash at the bottom of your deck:\" then play from the trash (EB01-043)", () => {
    const [fx] = costsOf("EB01-043");
    expect(fx.cost).toMatchObject([{ kind: "action", action: { kind: "returnToDeck", where: "bottom", sel: { zone: "trash", count: 3 } } }]);
    expect(fx.actions).toEqual(["playFromZone"]);
  });

  it("a NoCancel step after the cost is the payoff, not more cost (EB03-016)", () => {
    expect(costsOf("EB03-016")).toEqual([{ cost: [{ kind: "trashSelf" }], actions: ["giveRestedDon"] }]);
  });

  it("\"in any order\" pays both cost items (EB01-030); a downside on your Leader is a cost (EB01-004)", () => {
    expect(costsOf("EB01-030")[0].cost?.map((c) => c.kind)).toEqual(["action", "handToDeckBottom"]);
    expect(costsOf("EB01-004")[0].cost).toMatchObject([{ kind: "action", action: { kind: "powerMod", amount: -5000, sel: { zone: "leader" } } }]);
  });
});
