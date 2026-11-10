import { describe, expect, it } from "vitest";
import { parseDeckText, type DeckTextCard } from "./deckText";

const CARDS: Record<string, DeckTextCard> = {
  "OP13-001": { t: "L", cols: ["R", "G"] },
  "OP17-039": { t: "L", cols: ["B"] },
  "OP13-016": { t: "C", cols: ["R"] },
  "OP07-022": { t: "C", cols: ["G"] },
  "OP17-040": { t: "C", cols: ["B"] },
};
const parse = (text: string) => parseDeckText(text, (id) => CARDS[id]);

describe("parseDeckText", () => {
  it("reads the leader and the cards, ignoring blank lines and spacing", () => {
    expect(parse("1xOP13-001\r\n\n4xOP13-016\n  3 x op07-022  ")).toEqual({
      leaderId: "OP13-001", cards: { "OP13-016": 4, "OP07-022": 3 }, errors: [], lineErrors: [],
    });
  });

  it.each([
    ["4 OP13-016", 4],
    ["OP13-016 x4", 4],
    ["x3 OP13-016", 3],
    ["4 Edward.Newgate OP13-016", 4],
    ["2 Monkey.D.Luffy (OP13-016)", 2],
    ["OP13-016", 1],
    ["Monkey.D.Luffy (OP13-016)", 1],
    ["3x OP13-016", 3],
    ["OP13-016_p1 x2", 2],
  ])("reads %s from other sites' lists", (line, copies) => {
    const result = parse(`1xOP13-001\n${line}`);
    expect(result.errors).toEqual([]);
    expect(result.cards).toEqual({ "OP13-016": copies });
  });

  it("does not swallow the X of a code", () => {
    expect(parse("1xOP13-001\n4 XX99-999").errors).toEqual(["Unknown card: XX99-999"]);
  });

  it("keeps the good lines when only some lines are unreadable", () => {
    const result = parse("1xOP13-001\nLeader:\n4xOP13-016\n2xOP99-999");
    expect(result.cards).toEqual({ "OP13-016": 4 });
    expect(result.lineErrors).toHaveLength(2);
    expect(result.errors).toEqual(result.lineErrors);
  });

  it("adds up a card written twice", () => {
    expect(parse("1xOP13-001\n2xOP13-016\n2xOP13-016").cards).toEqual({ "OP13-016": 4 });
  });

  it.each([
    ["an unreadable line", "1xOP13-001\nfour Luffy", /Can't read/],
    ["an unknown card", "1xOP13-001\n4xOP99-999", /Unknown card: OP99-999/],
    ["no leader", "4xOP13-016", /No Leader/],
    ["two leaders", "1xOP13-001\n1xOP17-039", /More than one Leader/],
    ["two copies of the leader", "2xOP13-001", /must be 1 copy/],
    ["too many copies", "1xOP13-001\n5xOP13-016", /maximum is 4/],
    ["an off-color card", "1xOP13-001\n4xOP17-040", /Leader's colors/],
  ])("refuses %s", (_, text, message) => {
    expect(parse(text).errors.join(" ")).toMatch(message);
  });

  it("refuses more than 50 cards, and takes a list still under 50", () => {
    const big = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`OP01-${i}`, { t: "C", cols: ["R"] }]));
    const list = Object.keys(big).map((id) => `4x${id}`).join("\n");
    const result = parseDeckText(`1xOP13-001\n${list}`, (id) => CARDS[id] ?? big[id]);
    expect(result.errors.join(" ")).toMatch(/52 cards/);
    expect(parse("1xOP13-001\n4xOP13-016").errors).toEqual([]);
  });
});
