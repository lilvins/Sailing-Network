/** Translating optcgwebsim ids into the catalog's spelling: colors, card types, type categories, card names. (optcg-ai → AUTOSIM compiler, see README.md) */
import type { CatalogCard, CompileContext, OptcgCard } from "./types";

/** Card names as the catalog spells them, learned from the shared ids. */
export function buildNameMap(optcg: Record<string, OptcgCard>, catalog: (CatalogCard & { name?: string })[]): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = new Map(catalog.map((c) => [c.id, c]));
  for (const card of Object.values(optcg)) {
    const name = byId.get(card.id)?.name;
    if (name && name !== card.name && !(card.name in out)) out[card.name] = name;
  }
  return out;
}

export const catalogNames = (names: string[], a: { ctx: CompileContext }) => names.map((n) => a.ctx.names[n] ?? n);

// ─── enums ──────────────────────────────────────────────────────────────────

/** optcgwebsim StrikeType enum order → catalog attribute spelling. */
export const ATTRIBUTES = ["Strike", "Slash", "Ranged", "Special", "Wisdom"];
export const COLORS = ["Red", "Green", "Blue", "Purple", "Black", "Yellow"];
export const CARD_TYPES = ["Leader", "Character", "Event", "Stage"] as const;

/** PascalCase enum names, for categories the catalog never shows (sets it
 *  doesn't have yet): "RedHairedPiratesAllies" → "Red Haired Pirates Allies". */
export function spacedName(pascal: string): string {
  return pascal.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Category id → catalog type strings, learned from the cards both databases
 * share: the catalog types that appear on EVERY card carrying the id (ties
 * kept: optcgwebsim merges a few near-identical types, e.g. CP7/CP8).
 */
export function buildCategoryMap(
  optcg: Record<string, OptcgCard>,
  catalog: CatalogCard[],
  enumNames: Record<string, string>,
): Record<number, string[]> {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const counts = new Map<number, Map<string, number>>();
  for (const card of Object.values(optcg)) {
    const cat = byId.get(card.id);
    if (!cat) continue;
    for (const id of card.categories) {
      const m = counts.get(id) ?? new Map<string, number>();
      for (const t of cat.types) m.set(t, (m.get(t) ?? 0) + 1);
      counts.set(id, m);
    }
  }
  const out: Record<number, string[]> = {};
  for (const [idStr, name] of Object.entries(enumNames)) {
    const id = Number(idStr);
    const m = counts.get(id);
    if (!m || m.size === 0) { out[id] = [spacedName(name)]; continue; }
    const max = Math.max(...m.values());
    const tied = [...m.entries()].filter(([, n]) => n === max).map(([t]) => t).sort();
    // ties (every Admiral is also Navy): keep the type(s) the enum name spells
    const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const named = tied.filter((t) => flat(t).includes(flat(name)) || flat(name).includes(flat(t)));
    out[id] = named.length > 0 ? named : tied;
  }
  return out;
}
