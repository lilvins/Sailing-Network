// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Card } from "../../features/cards/cardsDb";
import { automationInfo } from "../../features/board-auto/compile";

/**
 * The meta-deck board (ROADMAP_META_AI tappa 1): for every meta deck known to
 * optcg-ai, how many copies run fully automatically in board-auto, and which
 * cards still don't (with board-auto's own disclosure note).
 *   UPDATE_OPTCG=1 → rewrites generated/meta-report.json (npm run compile:optcg)
 *   otherwise      → no deck may lose automatic copies against the committed file
 */

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const catalog: Card[] = read("../../../public/data/cards.json");
const bundle: { metaDecks: { name: string; leader: string; cards: string[] }[] } = read("../../../public/data/optcg/bundle.json");
const byId = new Map(catalog.map((c) => [c.id, c]));
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const FILE = new URL("../data/compiled/generated/meta-report.json", import.meta.url);

interface DeckRow {
  name: string;
  leader: string;
  leaderAutomatic: boolean;
  automatic: number;
  total: number;
  pct: number;
  /** cards that are not fully automatic, most copies first */
  blockers: { id: string; name: string; copies: number; note: string }[];
}

function deckRow(d: { name: string; leader: string; cards: string[] }): DeckRow | null {
  const ids = [d.leader, ...d.cards];
  if (!ids.every((id) => byId.has(id))) return null;
  const copies = new Map<string, number>();
  for (const id of ids) copies.set(id, (copies.get(id) ?? 0) + 1);
  const blockers: DeckRow["blockers"] = [];
  let automatic = 0;
  for (const [id, n] of copies) {
    const card = byId.get(id)!;
    const note = automationInfo(card).note;
    if (note === null) automatic += n;
    else blockers.push({ id, name: card.name, copies: n, note });
  }
  blockers.sort((a, b) => b.copies - a.copies || a.id.localeCompare(b.id));
  return {
    name: d.name, leader: d.leader, leaderAutomatic: automationInfo(byId.get(d.leader)!).note === null,
    automatic, total: ids.length, pct: Math.round((automatic / ids.length) * 1000) / 10, blockers,
  };
}

const seen = new Set<string>();
const rows = bundle.metaDecks
  .filter((d) => !seen.has(d.name) && seen.add(d.name))
  .map(deckRow)
  .filter((r): r is DeckRow => r !== null);

describe("meta-deck board (tappa 1)", () => {
  it("covers the meta decks inside the catalog", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it.skipIf(!!env.UPDATE_OPTCG)("no meta deck loses automatic copies", () => {
    if (!existsSync(FILE)) return;
    const committed: { decks: DeckRow[] } = JSON.parse(readFileSync(FILE, "utf8"));
    for (const old of committed.decks) {
      const now = rows.find((r) => r.name === old.name);
      if (now) expect(now.automatic, `${old.name}: ${now.automatic} < ${old.automatic}`).toBeGreaterThanOrEqual(old.automatic);
    }
  });

  it.runIf(!!env.UPDATE_OPTCG)("writes generated/meta-report.json", () => {
    const total = rows.reduce((s, r) => s + r.total, 0);
    const automatic = rows.reduce((s, r) => s + r.automatic, 0);
    const report = {
      source: "src/autosim/__tests__/meta-report.test.ts (board-auto automationInfo over optcg-ai metaDecks)",
      deckCount: rows.length,
      copies: { automatic, total, pct: Math.round((automatic / total) * 1000) / 10 },
      leadersAutomatic: rows.filter((r) => r.leaderAutomatic).length,
      decksAt100: rows.filter((r) => r.automatic === r.total).length,
    };
    writeFileSync(FILE, `${JSON.stringify({ ...report, decks: rows }, null, 1)}\n`);
  });
});
