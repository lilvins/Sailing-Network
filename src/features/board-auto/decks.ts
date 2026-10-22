/**
 * board-auto deck choices: engine-legal demo decks generated from the live
 * catalog (guaranteed to carry Blockers, [Trigger] cards and [Counter]
 * events so every battle window actually opens), plus the user's own decks.
 *
 * Deck construction legality (50 cards, ≤4 copies, leader colors — 5-1-2) is
 * ultimately enforced by the engine in createGame; this module only tries to
 * produce lists that pass it.
 */
import type { Card } from "../cards/cardsDb";
import type { Deck } from "../../lib/api";
import { innateKeywords } from "./compile";

export interface DeckChoice {
  key: string;
  name: string;
  sub: string;
  leaderId: string;
  /** 50 cardIds (demo decks always; user decks: whatever they saved). */
  main: string[];
  source: "demo" | "mine";
}

/** Leaders the demo generator tries, in order (skips missing ones). */
const DEMO_LEADERS = ["ST01-001", "ST02-001", "ST03-001", "ST04-001", "ST05-001", "ST06-001"];

function hasLineTag(text: string | null | undefined, tag: string): boolean {
  if (!text) return false;
  return text.split("\n").some((l) => l.trim().startsWith(tag));
}

/** Build one 50-card demo list for a leader, or null if the pool is too thin. */
function buildDemoList(leader: Card, all: Card[]): string[] | null {
  const leaderColors = new Set(leader.colors);
  const pool = all.filter(
    (c) => c.category !== "Leader" && c.colors.some((col) => leaderColors.has(col)),
  );
  if (pool.length * 4 < 50) return null;

  const sameSet = (c: Card) => (c.set === leader.set ? 0 : 1);
  const byIdAsc = (a: Card, b: Card) => sameSet(a) - sameSet(b) || (a.cost ?? 0) - (b.cost ?? 0) || a.id.localeCompare(b.id);

  const blockers = pool
    .filter((c) => c.category === "Character" && innateKeywords(c.effect).includes("Blocker"))
    .sort(byIdAsc);
  const counterEvents = pool
    .filter((c) => c.category === "Event" && hasLineTag(c.effect, "[Counter]"))
    .sort(byIdAsc);
  const triggerChars = pool
    .filter((c) => c.category === "Character" && !!c.trigger)
    .sort(byIdAsc);
  const cheapChars = pool
    .filter((c) => c.category === "Character" && (c.cost ?? 0) <= 4 && (c.counter ?? 0) > 0)
    .sort(byIdAsc);
  const rest = pool.filter((c) => c.category === "Character").sort(byIdAsc);

  const main: string[] = [];
  const copies = new Map<string, number>();
  const take = (c: Card, n: number) => {
    const have = copies.get(c.id) ?? 0;
    const add = Math.min(n, 4 - have, 50 - main.length);
    if (add <= 0) return;
    copies.set(c.id, have + add);
    for (let i = 0; i < add; i++) main.push(c.id);
  };

  // 2 blocker kinds ×4, 2 counter events ×4, 3 trigger characters ×4 = 28,
  // then cheap counter bodies, then anything, until exactly 50.
  for (const c of blockers.slice(0, 2)) take(c, 4);
  for (const c of counterEvents.slice(0, 2)) take(c, 4);
  for (const c of triggerChars.slice(0, 3)) take(c, 4);
  for (const c of cheapChars) { if (main.length >= 50) break; take(c, 4); }
  for (const c of rest) { if (main.length >= 50) break; take(c, 4); }

  return main.length === 50 ? main : null;
}

/** Demo decks from the catalog — deterministic, engine-legal. */
export function buildDemoDecks(cardsById: Map<string, Card>): DeckChoice[] {
  const all = [...cardsById.values()];
  const out: DeckChoice[] = [];
  for (const leaderId of DEMO_LEADERS) {
    const leader = cardsById.get(leaderId);
    if (!leader || leader.category !== "Leader") continue;
    const main = buildDemoList(leader, all);
    if (!main) continue;
    out.push({
      key: `demo:${leaderId}`,
      name: `Demo — ${leader.name}`,
      sub: `${leader.colors.join("/")} · ${leaderId} · blockers, triggers & counters included`,
      leaderId,
      main,
      source: "demo",
    });
  }
  return out;
}

/** The user's saved decks as choices (legality checked by the engine later). */
export function userDeckChoices(decks: Deck[]): DeckChoice[] {
  return decks
    .filter((d) => d.leaderId && d.cards.length > 0)
    .map((d) => {
      const main = d.cards.flatMap((c) => Array<string>(c.count).fill(c.id));
      return {
        key: `mine:${d.id}`,
        name: d.name,
        sub: `${d.leaderName || d.leaderId} · ${main.length} cards · My Decks`,
        leaderId: d.leaderId!,
        main,
        source: "mine" as const,
      };
    });
}
