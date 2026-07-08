/**
 * Card database loader.
 *
 * The catalog is generated at build time by `npm run cards` (scripts/build-cards.mjs)
 * from the community punk-records dataset, and written to /public/data/cards.json.
 * It is fetched once at runtime and cached. ~2.6k cards across all sets.
 *
 * This is plain data — it is NOT the game state. The serializable GameState
 * references cards by `id`; this module is just the lookup catalog.
 */

export type CardColor = "Red" | "Green" | "Blue" | "Purple" | "Black" | "Yellow";
export type CardCategory = "Leader" | "Character" | "Event" | "Stage";

export interface Card {
  /** Official card code, e.g. "OP01-001", "ST23-001", "EB04-007", "PRB02-008". */
  id: string;
  name: string;
  category: CardCategory;
  /** One or more colors (dual-color cards have two). */
  colors: CardColor[];
  /**
   * Play cost for Character/Event/Stage.
   * NOTE: for a Leader this field holds the Leader's **Life** value, not a cost
   * (a quirk of the source dataset). Treat `cost` as Life when `category === "Leader"`.
   */
  cost: number | null;
  power: number | null;
  counter: number | null;
  /** Tribes / subtypes, e.g. ["Straw Hat Crew", "Supernovas"]. */
  types: string[];
  /** Card attributes, e.g. ["Slash"], ["Strike"]. */
  attributes: string[];
  /** Rules text. `<br>` already converted to newlines; {Type} braces preserved. */
  effect: string;
  trigger: string | null;
  rarity: string;
  /** Set code derived from the id prefix, e.g. "OP01", "ST23", "EB04", "PRB02", "P". */
  set: string;
  /** Card art URL (dotgg.gg .webp — hotlink-friendly, used app-wide). */
  image: string;
  /** Official onepiece-cardgame.com image (reference; blocks hotlinking). */
  imageOfficial: string;
}

const DATA_URL = "/data/cards.json";

let cache: Promise<Card[]> | null = null;

/** Fetch the full catalog once; subsequent calls reuse the in-flight/resolved promise. */
export function loadCards(): Promise<Card[]> {
  if (!cache) {
    cache = fetch(DATA_URL).then((r) => {
      if (!r.ok) throw new Error(`Failed to load card database (${r.status})`);
      return r.json() as Promise<Card[]>;
    });
  }
  return cache;
}

/** A Map from card id -> Card, built once on top of loadCards(). */
let byIdCache: Promise<Map<string, Card>> | null = null;
export function loadCardsById(): Promise<Map<string, Card>> {
  if (!byIdCache) {
    byIdCache = loadCards().then((cards) => new Map(cards.map((c) => [c.id, c])));
  }
  return byIdCache;
}

/** Just the Leaders, for leader pickers. */
export async function loadLeaders(): Promise<Card[]> {
  return (await loadCards()).filter((c) => c.category === "Leader");
}

/** Group cards by set code, sets in ascending order. */
export async function loadCardsBySet(): Promise<Record<string, Card[]>> {
  const cards = await loadCards();
  const groups: Record<string, Card[]> = {};
  for (const c of cards) (groups[c.set] ??= []).push(c);
  return groups;
}

/** Short hue used across the UI for a card's primary color. */
export const COLOR_HEX: Record<CardColor, string> = {
  Red: "#c0392b",
  Green: "#1f8a5b",
  Blue: "#2a6fdb",
  Purple: "#7a3fa0",
  Black: "#2c3138",
  Yellow: "#caa023",
};

/** Primary color hex for a card (first color), with a neutral fallback. */
export function cardColorHex(card: Card): string {
  return COLOR_HEX[card.colors[0] as CardColor] ?? "#3a4a5e";
}
