import { describe, expect, it } from "vitest";
import type { Card } from "../cards/cardsDb";
import { getCompiledCard } from "../../autosim/data/compiled";
import { automationInfo, compiledFor, deriveCompiled, innateKeywords, makeCardDb } from "./compile";

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

  it("Event with [Main] and [Counter] lines → main stays manual, the exact power template is compiled", () => {
    const c = deriveCompiled(card({
      id: "T-04",
      category: "Event",
      effect: "[Main] K.O. up to 1 of your opponent's Characters.\n[Counter] Your Leader gains +2000 power during this battle.",
    }))!;
    expect(c.effects.map((e) => e.timing).sort()).toEqual(["counter", "main"]);
    expect(c.effects.find((e) => e.timing === "main")!.actions[0].kind).toBe("manual");
    expect(c.effects.find((e) => e.timing === "counter")!.actions).toEqual([
      { kind: "powerMod", amount: 2000, duration: "thisBattle", sel: { owner: "self", zone: "leader", count: 1, upTo: false, chooser: "controller" } },
    ]);
    expect(c.classification).toBe("partial");
  });

  it("[Counter] −N to the opponent (playtest bug 2026-10-27) is compiled, not manual", () => {
    const c = deriveCompiled(card({
      id: "T-07", category: "Event",
      effect: "[Counter] Give up to 1 of your opponent's Leader or Character cards −2000 power during this turn.",
    }))!;
    expect(c.classification).toBe("compiled");
    expect(c.effects[0]).toEqual({
      timing: "counter",
      actions: [{ kind: "powerMod", amount: -2000, duration: "thisTurn", sel: { owner: "opponent", zone: "leaderOrCharacter", count: 1, upTo: true, chooser: "controller" } }],
    });
  });

  it("optional trash cost + trailing text → cost compiled, first sentence automated, rest manual", () => {
    const c = deriveCompiled(card({
      id: "T-08", category: "Event",
      effect: "[Counter] You may trash 1 card from your hand: Up to 1 of your Leader or Character cards gains +3000 power during this battle. Then, draw 1 card.",
    }))!;
    const fx = c.effects[0];
    expect(fx.optional).toBe(true);
    expect(fx.cost).toEqual([{ kind: "trashFromHand", sel: { owner: "self", zone: "hand", count: 1, chooser: "controller" } }]);
    expect(fx.actions[0]).toMatchObject({ kind: "powerMod", amount: 3000, duration: "thisBattle" });
    expect(fx.actions[1]).toEqual({ kind: "manual", text: "Then, draw 1 card." });
    expect(c.classification).toBe("partial");
  });

  it("{Type} and [Name] filters are carried into the selector", () => {
    const t = deriveCompiled(card({ id: "T-09", category: "Event", effect: "[Counter] Up to 1 of your {Minks} type Leader or Character cards gains +4000 power during this battle." }))!;
    expect(t.effects[0].actions[0]).toMatchObject({ sel: { filter: { typeIncludes: ["Minks"] } } });
    const n = deriveCompiled(card({ id: "T-10", category: "Event", effect: "[Counter] Up to 1 of your [Enel] cards gains +2000 power during this battle." }))!;
    expect(n.effects[0].actions[0]).toMatchObject({ sel: { filter: { nameIncludes: ["Enel"] } } });
  });

  it("anything off-template stays fully manual", () => {
    const c = deriveCompiled(card({ id: "T-11", category: "Event", effect: "[Counter] Reveal 1 card from the top of your deck. If it costs 2 or more, K.O. it." }))!;
    expect(c.effects[0].actions).toEqual([{ kind: "manual", text: "[Counter] Reveal 1 card from the top of your deck. If it costs 2 or more, K.O. it." }]);
    expect(c.classification).toBe("unsupported");
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

describe("official M2 batch takes precedence over the fallback", () => {
  it("an ST01/OP01 id resolves to the batch IR, not the heuristic", () => {
    // ST01-006 is [Blocker]-only in the batch; give the catalog card a text
    // the heuristic would mis-read to prove the batch wins.
    const c = card({ id: "ST01-006", effect: "[Blocker] (…)", trigger: "Draw 1 card." });
    const ir = compiledFor(c)!;
    expect(ir).toBe(getCompiledCard("ST01-006"));
    expect(ir.notes ?? "").not.toMatch(/FALLBACK/);
    // batch compiles the leader's [Activate: Main] for real (not manual)
    const leader = compiledFor(card({ id: "ST01-001", category: "Leader" }))!;
    expect(leader.classification).toBe("compiled");
    expect(leader.effects.some((fx) => fx.actions.some((a) => a.kind === "manual"))).toBe(false);
  });

  it("a non-batched id still uses the heuristic fallback, marked as such", () => {
    const ir = compiledFor(card({ id: "ZZ99-001", trigger: "Draw 1 card." }))!;
    expect(getCompiledCard("ZZ99-001")).toBeUndefined();
    expect(ir.notes).toMatch(/FALLBACK/);
    expect(ir.classification).toBe("unsupported");
  });

  it("the batch covers all of ST01", () => {
    for (let i = 1; i <= 17; i++) {
      const id = `ST01-${String(i).padStart(3, "0")}`;
      expect(getCompiledCard(id), id).toBeDefined();
    }
  });
});

describe("automationInfo (M3 metric)", () => {
  it("[Activate: Main] leader ST01-001 is fully automated now — no note, no chips", () => {
    const info = automationInfo(card({ id: "ST01-001", category: "Leader", effect: "[Activate: Main] [Once Per Turn] …" }));
    expect(info).toEqual({ manual: false, inert: false, note: null });
  });

  it("a static-only card (OP01-001, fullyAutoExecutable=false) gets the M4 continuous-effect note", () => {
    const info = automationInfo(card({ id: "OP01-001", category: "Leader", effect: "[DON!! x1] [Your Turn] …" }));
    expect(info.inert).toBe(true);
    expect(info.manual).toBe(false);
    expect(info.note).toMatch(/continuous effect not yet automatic \(M4\)/);
  });

  it("a peek/search card (OP01-016 Nami) is fully automated", () => {
    expect(automationInfo(card({ id: "OP01-016", effect: "[On Play] Look at 5 cards…" })).note).toBeNull();
  });
});

describe("makeCardDb", () => {
  it("uses the batch for covered ids", () => {
    const map = new Map<string, Card>([["ST01-014", card({ id: "ST01-014", category: "Event", effect: "[Counter] …" })]]);
    const db = makeCardDb(map);
    expect(db("ST01-014").compiled).toBe(getCompiledCard("ST01-014"));
  });

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
