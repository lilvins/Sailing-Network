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
  it("an empty search matches everything", () => {
    expect(matchesSearch(xebec, "  ")).toBe(true);
  });
});
