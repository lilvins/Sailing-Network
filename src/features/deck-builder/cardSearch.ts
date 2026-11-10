/** The Deck Constructor's search box: name, card code and type, ignoring case
 *  and punctuation ("monkey d luffy" finds "Monkey.D.Luffy"). Every word typed
 *  must be found somewhere on the card. */
export interface SearchableCard { id: string; name: string; tags: string[] }

export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/&amp;/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchesSearch(card: SearchableCard, query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = ` ${normalizeSearch([card.name, card.id, ...card.tags].join(" "))} `;
  return words.every((w) => hay.includes(w));
}
