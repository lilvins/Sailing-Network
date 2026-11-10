/** The Deck Constructor's search box: name, card code, type and the card's text,
 *  ignoring case and punctuation ("monkey d luffy" finds "Monkey.D.Luffy").
 *  Every word typed must be on the card as a whole word, except the last, which
 *  may still be being typed ("Rocks" does not find "Rockstar" once another word
 *  follows it). Cards found by name, code or type come before cards found only
 *  in their text. */
export interface SearchableCard { id: string; name: string; tags: string[]; fx?: string; trigger?: string | null }

/** Where the search found the card: 0 = name, code or type; 1 = only in its text. */
export type SearchRank = 0 | 1;

export function normalizeSearch(text: string): string {
  return text.toLowerCase().replace(/&amp;/g, " ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Are all the words in these pieces of text (the last one as a beginning of a word)? */
function hasWords(words: string[], parts: string[]): boolean {
  const hay = ` ${normalizeSearch(parts.join(" "))} `;
  return words.every((w, i) => hay.includes(i === words.length - 1 ? ` ${w}` : ` ${w} `));
}

/** null when the card does not match; an empty search matches every card by name. */
export function searchRank(card: SearchableCard, query: string): SearchRank | null {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const label = [card.name, card.id, ...card.tags];
  if (words.length === 0 || hasWords(words, label)) return 0;
  if (hasWords(words, [...label, card.fx ?? "", card.trigger ?? ""])) return 1;
  return null;
}
