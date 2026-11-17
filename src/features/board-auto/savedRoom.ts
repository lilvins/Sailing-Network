/**
 * The friend game this browser is in, kept across a reload: its room code.
 * On its own, away from room.ts, so the app shell can ask "is there a game to
 * go back to?" without loading the rules engine.
 */
const SAVED_KEY = "sn-friend-game";

export function rememberRoom(code: string | null): void {
  try {
    if (code) localStorage.setItem(SAVED_KEY, code);
    else localStorage.removeItem(SAVED_KEY);
  } catch { /* storage off: a reload leaves the game */ }
}

export function savedCode(): string | null {
  try { return localStorage.getItem(SAVED_KEY); } catch { return null; }
}

export const hasSavedRoom = (): boolean => savedCode() !== null;
