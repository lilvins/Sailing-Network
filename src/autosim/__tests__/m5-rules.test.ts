import { describe, expect, it } from "vitest";
import type { CardRules, Effect } from "../ir/types";
import { applyIntent, createGame, type GameConfig } from "../engine/engine";
import { matchesFilter } from "../engine/effects";
import type { AutoGameState, CardDb, EngineCard } from "../engine/state";
import { getGeneratedCard } from "../data/compiled";

/** M5 printed game rules ("Under the rules of this game …"). */

const CARDS: Record<string, EngineCard> = {};
function addCard(id: string, rules: CardRules | null, o: Partial<EngineCard> = {}, effects: Effect[] = []): void {
  CARDS[id] = {
    id, category: "Character", cost: 1, power: 2000, counter: 1000, colors: ["Red"], types: ["T"], name: id, ...o,
    compiled: { cardId: id, version: 1, confidence: 1, classification: "compiled", keywords: [], effects, ...(rules ? { rules } : {}) },
  } as EngineCard;
}
addCard("L", null, { category: "Leader", cost: 5, power: 5000 });
addCard("L-RULES", { donDeck: 6, startOfGamePlay: { category: ["Stage"], typeIncludes: ["Mary Geoise"] }, deckBan: { category: ["Event"], costAtLeast: 2 } },
  { category: "Leader", cost: 5, power: 5000 });
addCard("L-DECKOUT", { winsOnDeckOut: true }, { category: "Leader", cost: 5, power: 5000 });
addCard("C-ANY", { anyCopies: true });
addCard("C-ALIAS", { alsoNames: ["Usopp"] });
addCard("S-MG", null, { category: "Stage", types: ["Mary Geoise"] });
addCard("E-2", null, { category: "Event", cost: 2 });
for (let i = 1; i <= 12; i++) addCard(`V${i}`, null);
const db: CardDb = (id) => CARDS[id] ?? (() => { throw new Error(`unknown card ${id}`); })();
const V = Array.from({ length: 12 }, (_, i) => `V${i + 1}`).flatMap((id) => [id, id, id, id]); // 48

function game(leader: string, deck: string[]): AutoGameState {
  const config: GameConfig = { seed: "rules", firstPlayer: "alice", players: [{ id: "alice", leader, deck }, { id: "bob", leader: "L", deck: [...V, "C-ANY", "C-ALIAS"] }] };
  return createGame(db, config).state;
}

describe("M5 printed game rules", () => {
  it("any number of copies; the Leader's DON!! deck size, banned cards and start-of-game Stage", () => {
    expect(() => game("L", [...V.slice(0, 42), ...Array<string>(8).fill("C-ANY")])).not.toThrow();
    expect(() => game("L", [...V.slice(0, 44), ...Array<string>(6).fill("V1")])).toThrow(/copies/);
    expect(() => game("L-RULES", [...V, "C-ANY", "E-2"])).toThrow(/Leader's rule/);
    const s = game("L-RULES", [...V, "C-ANY", "S-MG"]);
    expect(s.players.alice.don.deck).toBe(6);
    expect(s.players.alice.zones.stage.map((iid) => s.players.alice.instances[iid].cardId)).toEqual(["S-MG"]);
    expect(s.players.alice.zones.deck.length).toBe(49 - 5);
  });

  it("\"also treat this card's name as [Usopp]\"", () => {
    const s = game("L", [...V.slice(0, 48), "C-ALIAS", "C-ANY"]);
    const iid = Object.values(s.players.alice.instances).find((x) => x.cardId === "C-ALIAS")!.iid;
    expect(matchesFilter(db, s, "alice", iid, { nameIncludes: ["Usopp"] }, iid, false)).toBe(true);
    expect(matchesFilter(db, s, "alice", iid, { nameExcludes: ["Usopp"] }, iid, false)).toBe(false);
  });

  it("\"when your deck is reduced to 0, you win the game instead of losing\"", () => {
    let s = game("L-DECKOUT", [...V.slice(0, 48), "C-ANY", "C-ANY"]);
    s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
    s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
    s.players.alice.zones.deck = s.players.alice.zones.deck.slice(0, 1);
    // alice's 2nd turn: the draw empties the deck
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    s = applyIntent(db, s, { type: "endTurn", player: "bob" }).state;
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("alice");
  });
});

describe("M5 compiler: printed game rules", () => {
  it("OP16-042 / OP15-058 / OP13-079 / P-117 / EB04-038", () => {
    expect(getGeneratedCard("OP16-042")!.rules).toEqual({ anyCopies: true });
    expect(getGeneratedCard("OP15-058")!.rules).toEqual({ donDeck: 6 });
    expect(getGeneratedCard("OP13-079")!.rules).toMatchObject({ deckBan: { category: ["Event"], costAtLeast: 2 }, startOfGamePlay: { typeIncludes: ["Mary Geoise"] } });
    expect(getGeneratedCard("P-117")!.rules).toEqual({ winsOnDeckOut: true, deckOnly: { typeIncludes: ["East Blue"] } });
    expect(getGeneratedCard("EB04-038")!.rules?.alsoNames).toEqual(["Trafalgar Law", "Donquixote Rosinante"]);
  });
});

describe("M5 printed game rules (2)", () => {
  it("\"you do not lose when your deck has 0 cards. You lose at the end of the turn\"", () => {
    addCard("L-LATE", { deckOutLosesAtEndOfTurn: true }, { category: "Leader", cost: 5, power: 5000 });
    let s = game("L-LATE", [...V.slice(0, 48), "C-ANY", "C-ANY"]);
    s = applyIntent(db, s, { type: "respondMulligan", player: "alice", take: false }).state;
    s = applyIntent(db, s, { type: "respondMulligan", player: "bob", take: false }).state;
    s.players.alice.zones.deck = s.players.alice.zones.deck.slice(0, 1);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    s = applyIntent(db, s, { type: "endTurn", player: "bob" }).state; // alice draws her last card
    expect(s.phase).not.toBe("over");
    expect(s.players.alice.zones.deck.length).toBe(0);
    s = applyIntent(db, s, { type: "endTurn", player: "alice" }).state;
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("bob");
    expect(getGeneratedCard("OP15-022")!.rules).toEqual({ deckOutLosesAtEndOfTurn: true });
  });
});
