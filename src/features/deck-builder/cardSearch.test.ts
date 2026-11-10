import { describe, expect, it } from "vitest";
import { searchRank } from "./cardSearch";

const xebec = { id: "OP17-039", name: "Rocks.D.Xebec", tags: ["Rocks Pirates"] };
const trio = { id: "OP99-001", name: "Ace &amp; Sabo &amp; Luffy", tags: ["FILM"] };

describe("searchRank", () => {
  it("finds a card by type, by code and by name without the dots", () => {
    expect(searchRank(xebec, "Rocks Pirates")).toBe(0);
    expect(searchRank(xebec, "op17-039")).toBe(0);
    expect(searchRank(xebec, "Rocks D Xebec")).toBe(0);
  });
  it("an earlier word must be whole: Rocks Pirates is not Rockstar's Pirates", () => {
    expect(searchRank({ id: "OP09-016", name: "Rockstar", tags: ["Red-Haired Pirates"] }, "Rocks Pirates")).toBe(null);
    expect(searchRank(xebec, "xeb")).toBe(0);
  });
  it("reads & in a name, and needs every word typed", () => {
    expect(searchRank(trio, "Sabo & Luffy")).toBe(0);
    expect(searchRank(xebec, "Rocks Navy")).toBe(null);
  });
  it("finds the card's text and [Trigger] too, ranked after the name", () => {
    const fan = { id: "OP17-050", name: "Fan", tags: ["FILM"], fx: "Play a {Rocks Pirates} type card." };
    const nami = { id: "OP01-016", name: "Nami", tags: ["Straw Hat Crew"], fx: "", trigger: "Draw 1 card." };
    expect(searchRank(fan, "Rocks Pirates")).toBe(1);
    expect(searchRank(nami, "draw")).toBe(1);
    expect(searchRank({ id: "OP05-100", name: "Drawing Lots", tags: [] }, "draw")).toBe(0);
  });
  it("an empty search matches everything", () => {
    expect(searchRank(xebec, "  ")).toBe(0);
  });
});
