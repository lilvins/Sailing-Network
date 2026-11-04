import type { DeckChoice } from "./decks";

/** Ready-made lists offered to everyone, written like an OPTCGSim .deck file:
 *  the leader, then `NxCODE` per card (50 cards). */
const PRESETS: { key: string; name: string; sub: string; leaderId: string; list: string }[] = [
  {
    key: "preset:miracle-rg-luffy",
    name: "Miracle RG Luffy",
    sub: "OP13-001 · Bonney → Hiyori → Oden",
    leaderId: "OP13-001",
    list: `4xOP13-016 4xST30-004 4xEB05-001 2xOP11-003 2xEB04-007 2xOP07-022 3xST32-001 3xOP06-033
           4xEB01-013 4xOP14-031 4xOP12-023 2xOP13-027 4xST32-002 2xOP13-031 2xOP17-022 4xST31-005`,
  },
  {
    key: "preset:rocks-base",
    name: "Rocks — Base",
    sub: "OP17-039 · 1st at ChinoizeCup #125",
    leaderId: "OP17-039",
    list: `3xOP08-051 3xOP17-044 4xOP17-049 3xOP17-052 4xOP17-040 4xOP17-046 2xOP17-042 4xOP17-045
           4xOP17-054 4xOP17-118 4xOP17-048 3xOP17-050 4xOP17-056 4xOP17-055`,
  },
];

export function presetDeckChoices(): DeckChoice[] {
  return PRESETS.map(({ list, ...p }) => ({
    ...p,
    source: "preset",
    main: list.trim().split(/\s+/).flatMap((entry) => {
      const [count, id] = entry.split("x");
      return Array<string>(Number(count)).fill(id);
    }),
  }));
}
