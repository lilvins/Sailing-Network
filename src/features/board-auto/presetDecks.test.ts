import { describe, expect, it } from "vitest";
import { createGame } from "../../autosim/engine/engine";
import { realDb } from "../../autosim/__bench__/metaGames";
import { presetDeckChoices } from "./presetDecks";

describe("preset decks", () => {
  it.each(presetDeckChoices().map((d) => [d.name, d] as const))("%s is legal for the engine", (_, d) => {
    expect(d.main).toHaveLength(50);
    const player = (id: string) => ({ id, leader: d.leaderId, deck: d.main });
    expect(() => createGame(realDb, { seed: "preset", firstPlayer: "a", players: [player("a"), player("b")] })).not.toThrow();
  });
});
