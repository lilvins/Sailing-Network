import { create } from "zustand";
import { api, ApiError, type AuthUser, type SignupInput } from "../lib/api";

/**
 * Authentication state. Separate from uiStore (navigation) and the game store.
 * The session itself lives in an httpOnly cookie the JS can't read — this store
 * only mirrors "who is logged in" for the UI.
 */
type Status = "loading" | "ready";

interface AuthState {
  user: AuthUser | null;
  status: Status; // "loading" until the initial /me check resolves
  /** Restore session on app start (reads the cookie via /auth/me). */
  init: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",

  init: async () => {
    try {
      const { user } = await api.me();
      set({ user, status: "ready" });
    } catch {
      set({ user: null, status: "ready" });
    }
  },

  login: async (identifier, password) => {
    const { user } = await api.login(identifier, password);
    set({ user, status: "ready" });
  },

  signup: async (input) => {
    const { user } = await api.signup(input);
    set({ user, status: "ready" });
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      /* clear locally regardless */
    }
    set({ user: null });
  },
}));

export { ApiError };
export type { AuthUser };
