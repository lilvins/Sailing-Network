import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs server module, no type declarations
import { buildMetaReport, deckSignature } from "../server/stats/metaReport.mjs";

const cfg = { metaReport: { gridMinGames: 2, gridMaxLeaders: 16, bestListMoreThanGames: 2, bestListsPerLeader: 5 } };
const listA = [{ id: "OP01-002", count: 4 }, { id: "OP01-003", count: 4 }];
const listA2 = [{ id: "OP01-003", count: 4 }, { id: "OP01-002", count: 4 }]; // same cards, other order
const listB = [{ id: "OP01-004", count: 4 }];
const decks = new Map([
  ["d1", { name: "A by u1", cards: listA }],
  ["d2", { name: "A by u2", cards: listA2 }],
  ["d3", { name: "B", cards: listB }],
  ["d4", { name: "Other leader", cards: listB }],
]);

let n = 0;
const row = (user: string, deck: string, leader: string, opp: string, result: "win" | "loss", extra: Record<string, unknown> = {}) => ({
  id: `m${n++}`, user_id: user, my_deck_id: deck, my_leader_id: leader, opp_leader_id: opp, result,
  format: "OP15", created_at: 1000 + n, rating: 1500, ...extra,
});

describe("buildMetaReport", () => {
  it("treats the same cards as one list whoever built it", () => {
    expect(deckSignature(listA)).toBe(deckSignature(listA2));
  });

  it("keeps lists with more than N games, best win rate first", () => {
    const rows = [
      row("u1", "d1", "L1", "L2", "win"), row("u2", "d2", "L1", "L2", "win"), row("u1", "d1", "L1", "L2", "loss"),
      row("u3", "d3", "L1", "L2", "win"), row("u3", "d3", "L1", "L2", "win"), row("u3", "d3", "L1", "L2", "win"),
      row("u4", "d4", "L2", "L1", "loss"), row("u4", "d4", "L2", "L1", "loss"),
    ];
    const r = buildMetaReport(rows, decks, cfg);
    const L1 = r.bestLists.find((b: { leaderId: string }) => b.leaderId === "L1");
    expect(L1.lists.map((l: { name: string; games: number }) => [l.name, l.games])).toEqual([["B", 3], ["A by u1", 3]]);
    expect(L1.lists[1].players).toBe(2);
    // L2's list has only 2 games: not more than 2
    expect(r.bestLists.find((b: { leaderId: string }) => b.leaderId === "L2")).toBeUndefined();
  });

  it("grid cell = row leader's record vs column leader", () => {
    const rows = [row("u1", "d1", "L1", "L2", "win"), row("u1", "d1", "L1", "L2", "loss"), row("u4", "d4", "L2", "L1", "win"), row("u4", "d4", "L2", "L1", "win")];
    const r = buildMetaReport(rows, decks, cfg);
    const i1 = r.grid.leaders.findIndex((l: { leaderId: string }) => l.leaderId === "L1");
    const i2 = r.grid.leaders.findIndex((l: { leaderId: string }) => l.leaderId === "L2");
    expect(r.grid.cells[i1][i2]).toMatchObject({ games: 2, wins: 1, winRate: 50 });
    expect(r.grid.cells[i2][i1]).toMatchObject({ games: 2, wins: 2, winRate: 100 });
    expect(r.grid.cells[i1][i1]).toBeNull();
  });

  it("filters by format, date and the player's rating going in", () => {
    const rows = [
      row("u1", "d1", "L1", "L2", "win", { format: "OP14" }),
      row("u1", "d1", "L1", "L2", "win", { created_at: 50 }),
      row("u1", "d1", "L1", "L2", "win", { rating: 1300 }),
      row("u1", "d1", "L1", "L2", "win"),
    ];
    expect(buildMetaReport(rows, decks, cfg, { format: "OP15", from: 100, minRating: 1400 }).totalGames).toBe(1);
    expect(buildMetaReport(rows, decks, cfg, { maxRating: 1400 }).totalGames).toBe(1);
    expect(buildMetaReport(rows, decks, cfg).totalGames).toBe(4);
  });
});
