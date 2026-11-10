/** The Deck Constructor's search box: name, card code and type (and, on
 *  request, the card's text), ignoring case and punctuation ("monkey d luffy"
 *  finds "Monkey.D.Luffy"). Every word typed must be on the card as a whole word,
 *  except the last, which may still be being typed ("Rocks" does not find "Rockstar"
 *  once another word follows it). */
export interface SearchableCard { id: string; name: string; tags: string[]; fx?: string; trigger?: string | null }

export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/&amp;/g, " ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchesSearch(card: SearchableCard, query: string, inText = false): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const parts = [card.name, card.id, ...card.tags, ...(inText ? [card.fx ?? "", card.trigger ?? ""] : [])];
  const hay = ` ${normalizeSearch(parts.join(" "))} `;
  return words.every((w, i) => hay.includes(i === words.length - 1 ? ` ${w}` : ` ${w} `));
}
