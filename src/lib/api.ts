/**
 * Tiny typed client for the Sailing Network backend.
 * Requests go to /api/* (proxied to the local server by Vite in dev), always
 * with credentials so the httpOnly session cookie rides along.
 */

export type Role = "user" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: Role;
  displayName: string;
  createdAt: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    ...options,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// ---- auth ----
export interface SignupInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface Profile {
  bio: string;
  avatarColor: string;
  favoriteLeader: string | null;
  supporter: boolean;
  country: string; // ISO 3166 alpha-2, "" = not set
  wins: number;
  losses: number;
}

export interface DeckCard {
  id: string;
  count: number;
}

export interface Deck {
  id: string;
  userId: string;
  name: string;
  leaderId: string | null;
  leaderName: string;
  cards: DeckCard[];
  format: string;
  source: string;
  fav: boolean;
  wins: number;
  losses: number;
  createdAt: number;
  updatedAt: number;
}

export interface DeckInput {
  name: string;
  leaderId?: string | null;
  leaderName?: string;
  cards?: DeckCard[];
  format?: string;
  fav?: boolean;
}

export interface Match {
  id: string;
  opponent: { username: string | null; displayName: string };
  myDeckId: string | null;
  myDeckName: string;
  myLeaderId: string | null;
  oppLeaderId: string | null;
  result: "win" | "loss";
  onPlay: boolean;
  points: number;
  format: string;
  createdAt: number;
}

export interface DeckMatchup {
  oppLeaderId: string;
  games: number; wins: number;
  games1: number; wins1: number;
  games2: number; wins2: number;
}
export interface DeckStats {
  deckId: string;
  name: string;
  leaderId: string | null;
  leaderName: string;
  format: string;
  games: number; wins: number;
  games1: number; wins1: number;
  games2: number; wins2: number;
  matchups: DeckMatchup[];
}

export interface SiteStats {
  captains: number;
  decks: number;
  matches: number;
}

export type FriendStatus = "pending" | "accepted";
export type FriendRole = "incoming" | "outgoing";

export interface Friendship {
  id: string;
  status: FriendStatus;
  role: FriendRole;
  user: { id: string; username: string; displayName: string; role: Role };
  createdAt: number;
  updatedAt: number;
}

export interface ThreadSummary {
  peer: { id: string; username: string; displayName: string };
  lastBody: string;
  lastAt: number;
  lastFromMe: boolean;
  unread: number;
}

export interface ChatMessage {
  id: string;
  fromMe: boolean;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  avatarColor: string;
  favoriteLeader: string | null;
  supporter: boolean;
  wins: number;
  losses: number;
  deckCount: number;
  createdAt: number;
}

export type PresenceStatus = "offline" | "online" | "in_duel";

export interface Presence {
  status: PresenceStatus;
  lastSeen: number;
  updatedAt: number;
}

export const api = {
  signup: (input: SignupInput) =>
    request<{ user: AuthUser }>("/auth/signup", { method: "POST", body: JSON.stringify(input) }),

  login: (identifier: string, password: string) =>
    request<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: AuthUser | null }>("/auth/me"),

  // ---- profile ----
  myProfile: () => request<{ user: AuthUser; profile: Profile }>("/me/profile"),

  updateProfile: (patch: Partial<Omit<Profile, "wins" | "losses">>) =>
    request<{ profile: Profile }>("/me/profile", { method: "PATCH", body: JSON.stringify(patch) }),

  profileOf: (username: string) =>
    request<{ user: AuthUser; profile: Profile; decks: DeckSummary[]; social: FollowState }>(`/profiles/${encodeURIComponent(username)}`),

  profileStats: (username: string) => request<ProfileStats>(`/profiles/${encodeURIComponent(username)}/stats`),

  follow: (username: string) => request<{ social: FollowState }>(`/follows/${encodeURIComponent(username)}`, { method: "POST" }),
  unfollow: (username: string) => request<{ social: FollowState }>(`/follows/${encodeURIComponent(username)}`, { method: "DELETE" }),

  directory: () => request<{ users: DirectoryUser[] }>("/users"),

  // ---- decks ----
  myDecks: () => request<{ decks: Deck[] }>("/me/decks"),

  deck: (id: string) => request<{ deck: Deck }>(`/decks/${id}`),

  createDeck: (input: DeckInput) =>
    request<{ deck: Deck }>("/me/decks", { method: "POST", body: JSON.stringify(input) }),

  updateDeck: (id: string, patch: Partial<DeckInput>) =>
    request<{ deck: Deck }>(`/decks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteDeck: (id: string) => request<{ ok: true }>(`/decks/${id}`, { method: "DELETE" }),

  // ---- matches / stats ----
  myMatches: () => request<{ matches: Match[] }>("/me/matches"),

  myStats: (days = 0) => request<{ decks: DeckStats[] }>(`/me/stats${days ? `?days=${days}` : ""}`),

  // public (no auth) — landing/home counters
  siteStats: () => request<SiteStats>("/stats"),

  // ---- friends ----
  myFriends: () => request<{ friends: Friendship[] }>("/me/friends"),

  sendFriendRequest: (username: string) =>
    request<{ ok: true; friendship: { id: string; status: FriendStatus } }>(
      `/me/friends/${encodeURIComponent(username)}`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  respondFriend: (id: string, action: "accept" | "decline" | "remove") =>
    request<{ ok: true }>(`/me/friends/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }),

  // ---- messages ----
  myThreads: () => request<{ threads: ThreadSummary[] }>("/me/threads"),

  threadWith: (username: string) =>
    request<{ peer: { id: string; username: string; displayName: string }; messages: ChatMessage[] }>(
      `/threads/${encodeURIComponent(username)}`,
    ),

  sendThreadMessage: (username: string, body: string) =>
    request<{ message: ChatMessage }>(`/threads/${encodeURIComponent(username)}`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  markThreadRead: (username: string) =>
    request<{ ok: true }>(`/threads/${encodeURIComponent(username)}/read`, { method: "POST" }),

  // ---- admin ----
  adminListUsers: () => request<{ users: AuthUser[] }>("/admin/users"),

  adminSetRole: (id: string, role: Role) =>
    request<{ ok: true }>(`/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  // ---- presence ----
  updatePresence: (status: PresenceStatus) =>
    request<Presence>("/me/presence", {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  friendsPresence: () => request<Record<string, Presence>>("/friends/presence"),

  // ---- global chat ----
  chat: () => request<{ messages: GlobalMessage[] }>("/chat"),
  sendChat: (body: string) =>
    request<{ ok: true; id: string }>("/chat", { method: "POST", body: JSON.stringify({ body }) }),

  // ---- notifications ----
  notifications: () => request<{ notifications: Notification[]; unread: number }>("/me/notifications"),
  markNotificationsRead: () => request<{ ok: true }>("/me/notifications/read", { method: "POST" }),

  // ---- meta analytics ----
  meta: (days = 0) => request<MetaReport>(`/meta${days ? `?days=${days}` : ""}`),

  // ---- season ladder (Bounty) ----
  leaderboard: (limit = 100, filters: { leader?: string; country?: string } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (filters.leader) q.set("leader", filters.leader);
    if (filters.country) q.set("country", filters.country);
    return request<Leaderboard>(`/leaderboard?${q}`);
  },

  // ---- consolidated badge poll ----
  sync: () => request<SyncState>("/me/sync"),

  // ---- match logging (manual / local play) ----
  logMatch: (input: MatchLogInput) =>
    request<{ match: Match }>("/me/matches", { method: "POST", body: JSON.stringify(input) }),

  // ---- queue / matchmaking ----
  joinQueue: (deckId: string) =>
    request<{ ok: true }>("/me/queue/join", { method: "POST", body: JSON.stringify({ deckId }) }),

  leaveQueue: () =>
    request<{ ok: true }>("/me/queue/leave", { method: "POST" }),

  queueStatus: () =>
    request<QueueStatus>("/me/queue/status"),
};

export interface GlobalMessage {
  id: string;
  fromMe: boolean;
  username: string;
  displayName: string;
  avatarColor: string;
  favoriteLeader: string | null;
  body: string;
  createdAt: number;
}

export interface Notification {
  id: string;
  type: "friend_request" | "friend_accept" | "message" | "system";
  body: string;
  ref: string | null;
  read: boolean;
  actor: { username: string; displayName: string } | null;
  createdAt: number;
}

/** A win/loss record as the stats module sends it. Rates are % with one decimal, null when 0 games. */
export interface StatRecord {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** 95% Wilson interval in %, null when 0 games */
  ci: [number, number] | null;
  games1: number;
  wins1: number;
  winRate1: number | null;
  games2: number;
  wins2: number;
  winRate2: number | null;
}

export interface Tier {
  id: string;
  name: string;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  displayName: string;
  country: string;
  favoriteLeader: string | null;
  rank: number | null;
  rating: number;
  rd: number;
  provisional: boolean;
  bounty: number;
  peakBounty: number;
  tier: Tier;
  wins: number;
  losses: number;
  games: number;
  winRate: number | null;
  topLeaders: { leaderId: string; games: number; winRate: number | null }[];
  streak: number;
  lastMatchAt: number | null;
  /** only when the board is filtered by leader: this season's record with it */
  withLeader?: StatRecord;
}

export interface Leaderboard {
  season: string;
  totalRanked: number;
  tiers: (Tier & { players: number; share: number })[];
  tierRules: {
    tiers: (Tier & { min: number })[];
    topTier: Tier & { topN: number };
    provisionalRd: number;
    minGames: number;
    berriesPerPoint: number;
  };
  countries: string[];
  leaders: LeaderboardEntry[];
}

export interface BountyPoint {
  t: number;
  bounty: number;
}

export interface ProfileStats {
  season: string;
  ladder:
    | (LeaderboardEntry & {
        allTimePeakBounty: number;
        allTimePeakAt: number | null;
        bestStreak: number;
        history: BountyPoint[];
        pastSeasons: {
          season: string;
          bounty: number;
          peakBounty: number;
          games: number;
          wins: number;
          rank: number | null;
          tier: Tier | null;
          history: BountyPoint[];
        }[];
      })
    | null;
  summary: StatRecord & { last30Days: number; firstMatchAt: number | null };
  leaders: (StatRecord & { leaderId: string; matchups: (StatRecord & { oppLeaderId: string })[] })[];
  recent: {
    id: string;
    opponent: { username: string | null; displayName: string };
    myLeaderId: string | null;
    oppLeaderId: string | null;
    myDeckName: string;
    result: "win" | "loss";
    onPlay: boolean;
    format: string;
    bountyDelta: number | null;
    createdAt: number;
  }[];
}

export interface FollowState {
  followers: number;
  following: number;
  isFollowing: boolean;
}

export interface MetaLeader extends StatRecord {
  leaderId: string;
  players: number;
  share: number;
  adjustedWinRate: number | null;
  shareDelta: number;
  winRateDelta: number | null;
  /** at least `minGames` games in the window */
  enough: boolean;
}

export interface MetaReport {
  days: number;
  minGames: number;
  totalGames: number;
  leaders: MetaLeader[];
  matrix: {
    leaders: string[];
    /** cells[row][col] = row leader vs col leader, null = no games */
    cells: ({ games: number; wins: number; winRate: number | null; ci: [number, number] | null } | null)[][];
  };
}

export interface SyncState {
  presence: Presence;
  unreadMessages: number;
  incomingRequests: number;
  unreadNotifications: number;
}

export interface MatchLogInput {
  deckId: string;
  result: "win" | "loss";
  onPlay: boolean;
  oppLeaderId?: string | null;
  oppUsername?: string | null;
  format?: string;
}

export type QueueState = "idle" | "waiting" | "matched";

export interface QueueStatus {
  status: QueueState;
  position?: number;
  estimatedWait?: string;
  sessionId?: string;
  opponentUsername?: string | null;
  startNow?: boolean;
}

export interface DeckSummary {
  id: string;
  name: string;
  leaderId: string | null;
  leaderName: string;
  count: number;
  format: string;
  fav: boolean;
  wins: number;
  losses: number;
}
