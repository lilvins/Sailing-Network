import { create } from "zustand";
import { api, type ThreadSummary } from "../../lib/api";

/**
 * The logged-in captain's inbox, polled whatever page is open: it lights the
 * Messages icon and raises the "new message" notice, on the table too.
 */
const POLL_MS = 4000;

export interface InboxNotice {
  id: number;
  username: string;
  displayName: string;
  body: string;
}

interface InboxState {
  threads: ThreadSummary[];
  notice: InboxNotice | null;
  /** The thread on screen in the popup: it never counts as unread or notifies. */
  viewing: string | null;
  setViewing: (username: string | null) => void;
  dismissNotice: () => void;
  refresh: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

let timer: ReturnType<typeof setInterval> | undefined;
let noticeSeq = 0;
/** Last message time per peer; null until the first poll, which never notifies
 *  (letters that arrived while offline only light the icon). */
let seen: Map<string, number> | null = null;

export const useInboxStore = create<InboxState>((set, get) => ({
  threads: [],
  notice: null,
  viewing: null,
  setViewing: (viewing) => set({ viewing }),
  dismissNotice: () => set({ notice: null }),
  refresh: async () => {
    try {
      const { threads } = await api.myThreads();
      const fresh = seen
        ? threads.filter((t) => t.unread > 0 && !t.lastFromMe && t.lastAt > (seen?.get(t.peer.username) ?? 0) && t.peer.username !== get().viewing)
        : [];
      seen = new Map(threads.map((t) => [t.peer.username, t.lastAt]));
      set({ threads });
      const latest = fresh.sort((a, b) => b.lastAt - a.lastAt)[0];
      if (latest) set({ notice: { id: ++noticeSeq, username: latest.peer.username, displayName: latest.peer.displayName, body: latest.lastBody } });
    } catch {
      /* the next poll tries again */
    }
  },
  start: () => {
    if (timer !== undefined) return;
    void get().refresh();
    timer = setInterval(() => void get().refresh(), POLL_MS);
  },
  stop: () => {
    clearInterval(timer);
    timer = undefined;
    seen = null;
    set({ threads: [], notice: null, viewing: null });
  },
}));

/** Unread letters, leaving out the thread being read right now. */
export function selectUnread(s: Pick<InboxState, "threads" | "viewing">): number {
  return s.threads.reduce((n, t) => (t.peer.username === s.viewing ? n : n + t.unread), 0);
}
