import { describe, expect, it } from "vitest";
import { matchesSearch } from "./cardSearch";

const xebec = { id: "OP17-039", name: "Rocks.D.Xebec", tags: ["Rocks Pirates"] };
const trio = { id: "OP99-001", name: "Ace &amp; Sabo &amp; Luffy", tags: ["FILM"] };

describe("matchesSearch", () => {
  it("finds a card by type, by code and by name without the dots", () => {
    expect(matchesSearch(xebec, "Rocks Pirates")).toBe(true);
    expect(matchesSearch(xebec, "op17-039")).toBe(true);
    expect(matchesSearch(xebec, "Rocks D Xebec")).toBe(true);
  });
  it("reads & in a name, and needs every word typed", () => {
    expect(matchesSearch(trio, "Sabo & Luffy")).toBe(true);
    expect(matchesSearch(xebec, "Rocks Navy")).toBe(false);
  });
  it("reads the card's text only when asked", () => {
    const fan = { id: "OP17-050", name: "Fan", tags: ["FILM"], fx: "Play a {Rocks Pirates} type card." };
    expect(matchesSearch(fan, "Rocks Pirates")).toBe(false);
    expect(matchesSearch(fan, "Rocks Pirates", true)).toBe(true);
  });
  it("an empty search matches everything", () => {
    expect(matchesSearch(xebec, "  ")).toBe(true);
  });
});
