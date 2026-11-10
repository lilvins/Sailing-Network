/** Which deck the Duel Room has chosen: remembered between visits, and set by
 *  the "Play" buttons of the deck pages. */
const KEY = "sn-duel-deck";

export function rememberDuelDeck(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* storage off: the first deck is chosen */ }
}

export function rememberedDuelDeck(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
