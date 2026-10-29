import { describe, expect, it } from "vitest";
import { getGeneratedCard } from "../data/compiled";

/**
 * "Look at N, place them at the top or bottom. Then, X": optcg-ai writes X
 * once per branch of the top/bottom choice. The compiler used to stop at the
 * choice and drop X (Streusen OP17-050 never drew its card).
 */
describe("top/bottom view keeps what comes after it", () => {
  const actions = (id: string) => getGeneratedCard(id)?.effects.flatMap((e) => e.actions.map((a) => a.kind));

  it("Streusen OP17-050 draws 1 after the look", () => {
    expect(actions("OP17-050")).toEqual(["peekDeck", "draw"]);
  });

  it("P-109 and ST17-004 give a rested DON!! after the look", () => {
    expect(actions("P-109")).toEqual(["peekDeck", "giveRestedDon"]);
    expect(actions("ST17-004")).toEqual(["peekDeck", "giveRestedDon"]);
  });
});
