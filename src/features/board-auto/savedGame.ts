import type { GameEvent } from "../../autosim/engine/events";
import type { AutoGameState } from "../../autosim/engine/state";
import type { SeatSetup } from "./autoStore";

/**
 * The game in progress, kept in sessionStorage so a page reload (a refresh, a
 * phone killing the tab, the dev server's hot reload) resumes it instead of
 * losing it. The engine state is plain JSON by design, so this is a copy.
 * Per tab, and best effort: storage can be missing or full (try/catch).
 */
export interface SavedGame {
  seats: [SeatSetup, SeatSetup];
  game: AutoGameState;
  events: GameEvent[];
  aiDelay: number;
}

const KEY = "boardauto:game:v1";
/** The log keeps only its tail across a reload: the state itself is complete. */
const MAX_EVENTS = 600;

export function saveGame(g: SavedGame): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...g, events: g.events.slice(-MAX_EVENTS) }));
  } catch { /* no storage, or full: the game just will not survive a reload */ }
}

export function loadGame(): SavedGame | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedGame) : null;
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
