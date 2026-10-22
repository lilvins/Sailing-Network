/**
 * Lookup API over the AI-compiled card IR (AUTOSIM_PLAN.md §6, M2).
 *
 * `st01-op01.json` is the versioned output artifact of the M2 compilation
 * batch (ST01 + OP01, 138 cards); `coverage-report.json` summarizes it and is
 * asserted against a recomputation in tests so it can never drift. Consumers
 * (board-auto, future sets) go through `getCompiledCard` — nothing reads the
 * JSON files directly.
 */
import type { CompiledCard } from "../../ir/types";
import st01op01 from "./st01-op01.json";

/** All compiled batches, newest last (later sets land here in M3+). */
const BATCHES = [st01op01 as unknown as CompiledCard[]];

const byId: Record<string, CompiledCard> = {};
for (const batch of BATCHES) {
  for (const card of batch) byId[card.cardId] = card;
}

/** The compiled IR for a card, or undefined if the card's set has not been
 *  compiled yet (the engine then treats it as effect-less — plan §1.3). */
export function getCompiledCard(cardId: string): CompiledCard | undefined {
  return byId[cardId];
}

/** Every compiled card, for validation/reporting. */
export function allCompiledCards(): CompiledCard[] {
  return BATCHES.flat();
}

export interface CoverageRow {
  vanilla: number;
  "keyword-only": number;
  compiled: number;
  partial: number;
  unsupported: number;
  total: number;
  /** vanilla + keyword-only + compiled, as a fraction of total. */
  coveredPct: number;
}

/** Classification counts per set prefix (e.g. "ST01"), plus "ALL". */
export function coverage(): Record<string, CoverageRow> {
  const rows: Record<string, CoverageRow> = {};
  const bump = (key: string, cls: CompiledCard["classification"]) => {
    const row = (rows[key] ??= {
      vanilla: 0, "keyword-only": 0, compiled: 0, partial: 0, unsupported: 0, total: 0, coveredPct: 0,
    });
    row[cls] += 1;
    row.total += 1;
  };
  for (const card of allCompiledCards()) {
    bump(card.cardId.split("-")[0], card.classification);
    bump("ALL", card.classification);
  }
  for (const row of Object.values(rows)) {
    row.coveredPct = Math.round(((row.vanilla + row["keyword-only"] + row.compiled) / row.total) * 1000) / 10;
  }
  return rows;
}
