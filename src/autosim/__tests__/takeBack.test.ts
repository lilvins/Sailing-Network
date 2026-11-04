import { describe, expect, it } from "vitest";
import { takeBackStart } from "../engine/takeBack";

const A = "seatA";
const B = "seatB";
const m = (player: string, type: string) => ({ player, type });

describe("takeBackStart", () => {
  it("goes back to before the attack, not to one of its steps (Rocks)", () => {
    const moves = [m(A, "giveDon"), m(A, "attack"), m(A, "respondMay"), m(A, "respondTargets"), m(A, "respondPeek")];
    expect(takeBackStart(moves, A)).toBe(1);
  });

  it("still finds the attack after the defender answered, and undoes those answers too", () => {
    const moves = [m(A, "attack"), m(A, "respondMay"), m(B, "respondBlock"), m(B, "passCounter"), m(A, "respondTargets")];
    expect(takeBackStart(moves, A)).toBe(0);
  });

  it("takes back a played card with its [On Play] choices", () => {
    const moves = [m(A, "attack"), m(A, "playCard"), m(A, "respondTargets"), m(A, "respondTargets")];
    expect(takeBackStart(moves, A)).toBe(1);
  });

  it("the defender only loses their answers, never their previous turn", () => {
    const moves = [m(B, "attack"), m(B, "endTurn"), m(A, "attack"), m(B, "respondBlock"), m(B, "useCounter"), m(B, "passCounter")];
    expect(takeBackStart(moves, B)).toBe(3);
  });

  it("an ended turn is an action of its own", () => {
    expect(takeBackStart([m(A, "playCard"), m(A, "endTurn")], A)).toBe(1);
  });

  it("a mulligan answer goes back alone, and no move means nothing to take back", () => {
    expect(takeBackStart([m(B, "respondMulligan"), m(A, "respondMulligan")], A)).toBe(1);
    expect(takeBackStart([m(B, "respondMulligan")], A)).toBe(-1);
  });
});
