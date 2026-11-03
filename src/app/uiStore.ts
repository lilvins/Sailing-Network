import { create } from "zustand";

/**
 * UI-only state: navigation. Deliberately SEPARATE from the game store:
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
  | "messages" // not a page: going there opens the Messages window over the current one
  | "friends"
  | "global-chat"
  | "meta"
  | "popular-decklists"
  | "admin"
  | "credits" // artists, fonts and data sources
  | "board" // the playmat (current layout)
  | "board2" // layout lab — OPTCGSim-style table
  | "board-auto" // AUTOSIM full-rules board (engine-driven)
  | "board-bot"; // optcg-ai engine + bot (Play vs Bot)

interface UiState {
  view: View;
  setView: (view: View) => void;
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
  /** The Messages window, floating over whatever page is open. */
  messagesOpen: boolean;
  setMessagesOpen: (open: boolean) => void;
  /** The game table is turned 90° (phone held sideways): the window turns with it. */
  tableRotated: boolean;
}

export const useUiStore = create<UiState>((set) => ({
  view: "login", // the landing/login is the entry screen

  setView: (view) => set(view === "messages" ? { messagesOpen: true } : { view }),
  pendingImport: null,
  setPendingImport: (pendingImport) => set({ pendingImport }),
  editingDeckId: null,
  openDeckBuilder: (editingDeckId) => set({ editingDeckId, view: "deck-constructor" }),
  viewingUsername: null,
  openProfile: (viewingUsername) => set({ viewingUsername, view: "profile-viewer" }),
  openThreadWith: null,
  openMessagesWith: (openThreadWith) => set({ openThreadWith, messagesOpen: true }),
  messagesOpen: false,
  setMessagesOpen: (messagesOpen) => set(messagesOpen ? { messagesOpen } : { messagesOpen, openThreadWith: null }),
  tableRotated: false,
}));
