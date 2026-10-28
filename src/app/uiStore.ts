import { create } from "zustand";

/**
 * UI-only state: navigation + theme. Deliberately SEPARATE from the game store:
 * presentation, not game state, so the (serializable) GameState stays clean.
 */
export type View =
  | "login"
  | "home"
  | "duel-room"
  | "deck-constructor"
  | "my-decks"
  | "directory"
  | "profile-viewer"
  | "edit-profile"
  | "rankings"
  | "records"
  | "statistics"
  | "messages"
  | "friends"
  | "global-chat"
  | "meta"
  | "notifications"
  | "popular-decklists"
  | "admin"
  | "board" // the playmat (current layout)
  | "board2" // layout lab — OPTCGSim-style table
  | "board-auto" // AUTOSIM full-rules board (engine-driven)
  | "board-bot"; // optcg-ai engine + bot (Play vs Bot)

export type Theme = "dark" | "light";

const THEME_KEY = "sn-theme";

function readInitialTheme(): Theme {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  }
  return "dark";
}

/** Apply the theme to <html data-theme> so CSS can switch palettes globally. */
function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

const initialTheme = readInitialTheme();
applyTheme(initialTheme); // set before first paint

interface UiState {
  view: View;
  setView: (view: View) => void;
  theme: Theme;
  toggleTheme: () => void;
  /** A decklist (cardId -> count) handed off to the Deck Builder via "Import". */
  pendingImport: Record<string, number> | null;
  setPendingImport: (deck: Record<string, number> | null) => void;
  /** Deck id the Deck Constructor should load (null = a fresh "New Deck"). */
  editingDeckId: string | null;
  /** Navigate to the Deck Constructor for a given deck (or null for a new one). */
  openDeckBuilder: (deckId: string | null) => void;
  /** Username the Profile Viewer should open by default (null = self). */
  viewingUsername: string | null;
  openProfile: (username: string | null) => void;
  /** Username Messages should auto-open the thread with (null = none). */
  openThreadWith: string | null;
  openMessagesWith: (username: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "login", // the landing/login is the entry screen

  setView: (view) => set({ view }),
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark";
      if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
      applyTheme(theme);
      return { theme };
    }),
  pendingImport: null,
  setPendingImport: (pendingImport) => set({ pendingImport }),
  editingDeckId: null,
  openDeckBuilder: (editingDeckId) => set({ editingDeckId, view: "deck-constructor" }),
  viewingUsername: null,
  openProfile: (viewingUsername) => set({ viewingUsername, view: "profile-viewer" }),
  openThreadWith: null,
  openMessagesWith: (openThreadWith) => set({ openThreadWith, view: "messages" }),
}));
