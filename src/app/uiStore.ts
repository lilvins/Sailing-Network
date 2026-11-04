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
  /** The pages visited before this one (what the Back button returns to). */
  navStack: View[];
  goBack: () => void;
  /** The one page the player may be on (a friend game in progress keeps them at
   *  the table): every other navigation is ignored until it is released. */
  lockedView: View | null;
  lockView: (view: View | null) => void;
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

const pushed = (s: { view: View; navStack: View[] }, next: View): View[] =>
  s.view === next || s.view === "login" ? s.navStack : [...s.navStack, s.view].slice(-30);

/** Leaving a locked page is refused; the login screen (a lost session) is not a leave. */
const locked = (s: { lockedView: View | null }, next: View): boolean =>
  s.lockedView !== null && next !== s.lockedView && next !== "login";

export const useUiStore = create<UiState>((set) => ({
  view: "login", // the landing/login is the entry screen

  setView: (view) =>
    set((s) => (view === "messages" ? { messagesOpen: true } : locked(s, view) ? s : { view, navStack: pushed(s, view) })),
  navStack: [],
  goBack: () =>
    set((s) => {
      const back = s.navStack[s.navStack.length - 1] ?? "home";
      return locked(s, back) ? s : { view: back, navStack: s.navStack.slice(0, -1) };
    }),
  lockedView: null,
  lockView: (lockedView) => set({ lockedView }),
  pendingImport: null,
  setPendingImport: (pendingImport) => set({ pendingImport }),
  editingDeckId: null,
  openDeckBuilder: (editingDeckId) =>
    set((s) => (locked(s, "deck-constructor") ? s : { editingDeckId, view: "deck-constructor", navStack: pushed(s, "deck-constructor") })),
  viewingUsername: null,
  openProfile: (viewingUsername) =>
    set((s) => (locked(s, "profile-viewer") ? s : { viewingUsername, view: "profile-viewer", navStack: pushed(s, "profile-viewer") })),
  openThreadWith: null,
  openMessagesWith: (openThreadWith) => set({ openThreadWith, messagesOpen: true }),
  messagesOpen: false,
  setMessagesOpen: (messagesOpen) => set(messagesOpen ? { messagesOpen } : { messagesOpen, openThreadWith: null }),
  tableRotated: false,
}));
