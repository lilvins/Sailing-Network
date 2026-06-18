import { create } from "zustand";
import { api, type Presence, type PresenceStatus } from "./api";

interface PresenceState {
  presences: Record<string, Presence>;
  fetch: () => Promise<void>;
  update: (status: PresenceStatus) => Promise<void>;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presences: {},

  fetch: async () => {
    try {
      const p = await api.friendsPresence();
      set({ presences: p || {} });
    } catch {
      // silent
    }
  },

  update: async (status: PresenceStatus) => {
    try {
      await api.updatePresence(status);
    } catch {
      // silent
    }
  },

  clear: () => set({ presences: {} }),
}));
