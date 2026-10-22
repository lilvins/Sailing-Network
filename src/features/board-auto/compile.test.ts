import { describe, expect, it } from "vitest";
import type { Card } from "../cards/cardsDb";
import { deriveCompiled, innateKeywords, makeCardDb } from "./compile";

/** Minimal catalog card factory. */
function card(partial: Partial<Card> & { id: string }): Card {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    category: partial.category ?? "Character",
    colors: partial.colors ?? ["Red"],
    cost: partial.cost ?? 1,
    power: partial.power ?? 1000,
    counter: partial.counter ?? null,
    types: partial.types ?? [],
    attributes: [],
    effect: partial.effect ?? "",
    trigger: partial.trigger ?? null,
    rarity: "C",
    set: partial.id.split("-")[0],
    image: "",
    imageOfficial: "",
  };
}

describe("innateKeywords (line-start rule)", () => {
  it("reads keyword tags that open a line, reminder text included", () => {
    expect(innateKeywords("[Blocker] (After your opponent declares an attack, you may rest this card to make it the new target of the attack.)")).toEqual(["Blocker"]);
    expect(innateKeywords("[Rush] (This card can attack on the turn in which it is played.)")).toEqual(["Rush"]);
    expect(innateKeywords("[Double Attack]\n[Banish]")).toEqual(expect.arrayContaining(["DoubleAttack", "Banish"]));
  });

  it("matches [Rush: Character] before [Rush]", () => {
    expect(innateKeywords("[Rush: Character] (...)")).toEqual(["RushCharacter"]);
  });

  it("stacks several tags on one line", () => {
    expect(innateKeywords("[Blocker] [Rush]")).toEqual(expect.arrayContaining(["Blocker", "Rush"]));
  });

  it("does NOT treat granted keywords as innate", () => {
    expect(innateKeywords("[When Attacking] This Character gains [Rush] during this turn.")).toEqual([]);
    expect(innateKeywords("[On Play] Up to 1 of your Characters gains [Blocker].")).toEqual([]);
  });

  it("handles empty / null text", () => {
    expect(innateKeywords("")).toEqual([]);
    expect(innateKeywords(null)).toEqual([]);
  });
});

describe("deriveCompiled", () => {
  it("vanilla card → null (no CompiledCard)", () => {
    expect(deriveCompiled(card({ id: "T-01" }))).toBeNull();
  });

  it("keyword-only card → classification keyword-only, no effects", () => {
    const c = deriveCompiled(card({ id: "T-02", effect: "[Blocker] (…)" }))!;
    expect(c.classification).toBe("keyword-only");
    expect(c.keywords).toEqual(["Blocker"]);
    expect(c.effects).toHaveLength(0);
  });

  it("[Trigger] text → a manual trigger effect (engine offers the decision)", () => {
    const c = deriveCompiled(card({ id: "T-03", trigger: "Draw 1 card." }))!;
    expect(c.classification).toBe("unsupported");
    expect(c.effects).toEqual([
      { timing: "trigger", actions: [{ kind: "manual", text: "[Trigger] Draw 1 card." }] },
    ]);
  });

  it("Event with [Main] and [Counter] lines → both manual effects", () => {
    const c = deriveCompiled(card({
      id: "T-04",
      category: "Event",
      effect: "[Main] K.O. up to 1 of your opponent's Characters.\n[Counter] Your Leader gains +2000 power during this battle.",
    }))!;
    expect(c.effects.map((e) => e.timing).sort()).toEqual(["counter", "main"]);
    for (const fx of c.effects) expect(fx.actions[0].kind).toBe("manual");
  });

  it("Event with only [Counter] → NOT playable in main (no main effect)", () => {
    const c = deriveCompiled(card({ id: "T-05", category: "Event", effect: "[Counter] +2000." }))!;
    expect(c.effects.map((e) => e.timing)).toEqual(["counter"]);
  });

  it("Character effect text other than keywords/trigger stays uncompiled (vanilla behavior)", () => {
    const c = deriveCompiled(card({ id: "T-06", effect: "[On Play] Draw 2 cards." }));
    expect(c).toBeNull(); // no keywords, no trigger, not an Event → vanilla
  });
});

describe("makeCardDb", () => {
  it("maps catalog fields and caches compilation", () => {
    const map = new Map<string, Card>([
      ["L-01", card({ id: "L-01", category: "Leader", cost: 4, power: 5000 })],
      ["T-02", card({ id: "T-02", effect: "[Blocker] (…)", counter: 1000 })],
    ]);
    const db = makeCardDb(map);
    const leader = db("L-01");
    expect(leader.category).toBe("Leader");
    expect(leader.cost).toBe(4); // Life value quirk passes through
    const blk = db("T-02");
    expect(blk.compiled?.keywords).toEqual(["Blocker"]);
    expect(db("T-02")).toBe(blk); // cached
    expect(() => db("NOPE")).toThrow(/unknown card/);
  });
});
