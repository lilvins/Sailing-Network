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

/**
 * Category ids → the catalog's type strings. `a type including "X"` (2-4-3)
 * means every type whose name contains X: optcgwebsim lists the ones it has,
 * the catalog may have more ("CP" → {CP6} and {CP8} too). A card that also
 * names such a type in braces keeps the data's list.
 */
export function typesOfCategories(ids: number[], a: { ctx: CompileContext; cardText?: string }, unknown: (id: number) => never): string[] {
  const out = new Set(ids.flatMap((id) => a.ctx.categoryTypes[id] ?? unknown(id)));
  const text = a.cardText ?? "";
  for (const m of text.matchAll(/types? includ(?:es|ing) "([^"]+)"/gi)) {
    const word = m[1];
    if (![...out].some((t) => t.includes(word))) continue; // another filter of this card
    if ([...text.matchAll(/\{([^}]+)\}/g)].some((b) => b[1].includes(word))) continue;
    for (const t of a.ctx.catalogTypes ?? []) if (t.includes(word)) out.add(t);
  }
  return [...out];
}

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
  const cardsWith = new Map<string, number>(); // catalog type → how many shared cards carry it
  for (const card of Object.values(optcg)) {
    const cat = byId.get(card.id);
    if (!cat) continue;
    for (const t of cat.types) cardsWith.set(t, (cardsWith.get(t) ?? 0) + 1);
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
    const onAll = [...m.entries()].filter(([, n]) => n === max).map(([t]) => t).sort();
    // ties (every Admiral is also Navy, every Shandian Warrior is also Sky
    // Island): the id is the type fewest other cards carry — the wider one
    // would let a {Shandian Warrior} effect take any {Sky Island} card
    const fewest = Math.min(...onAll.map((t) => cardsWith.get(t) ?? 0));
    const tied = onAll.filter((t) => (cardsWith.get(t) ?? 0) === fewest);
    // still tied (CP7/CP8 on one card): keep the type(s) the enum name spells
    const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const named = tied.filter((t) => flat(t).includes(flat(name)) || flat(name).includes(flat(t)));
    out[id] = named.length > 0 ? named : tied;
  }
  return out;
}
