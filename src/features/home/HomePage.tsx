import { useEffect, useMemo, useState } from "react";
import { useUiStore, type View } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { usePresenceStore } from "../../lib/presenceStore";
import {
  api,
  type SiteStats,
  type LeaderboardEntry,
  type MetaLeader,
  type Friendship,
  type DirectoryUser,
  type GlobalMessage,
} from "../../lib/api";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { NightSea } from "./NightSea";
import "./home.css";

/* Home hub — "one place for everything" (plancia di notte identity):
   Play band · live gauges · leaderboard + meta · index tiles,
   with the social dock promoted to a persistent rail. */

const IconPaths = {
  duel: "M3 21l6-6M14 4l6 6M7 17l10-10M13 3h8v8M9 15l-2 2-4-4 2-2",
  board: "M3 5h18v14H3zM3 12h18M12 5v14",
  lab: "M9 3v6l-5 9a2 2 0 002 3h12a2 2 0 002-3l-5-9V3M8 3h8",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  deck: "M4 8l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  rank: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM5 6H3v2a3 3 0 003 3M19 6h2v2a3 3 0 01-3 3",
  records: "M3 5h18v14H3zM3 9h18M8 5v14M8 12l4 2-4 2v-4z",
  stats: "M3 3v18h18M8 17v-5M13 17V8M18 17v-9",
  exit: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  chat: "M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  bell: "M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  friends:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  trophy:
    "M8 21h8M12 17v4M6 4h12v4a6 6 0 01-12 0V4zM6 6H3v2a3 3 0 003 3M18 6h3v2a3 3 0 01-3 3",
  admin: "M12 3l8 4v5c0 4.5-3 7.6-8 9-5-1.4-8-4.5-8-9V7l8-4zM9.5 12l1.8 1.8L15 10",
  arrow: "M5 12h14M13 6l6 6-6 6",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 014 9 14 14 0 01-4 9 14 14 0 01-4-9 14 14 0 014-9z",
} as const;

type IconName = keyof typeof IconPaths;

function Icon({ name, size = 20, sw = 1.8 }: { name: IconName; size?: number; sw?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={IconPaths[name]} />
    </svg>
  );
}

function Logo() {
  return (
    <div className="sn-logo">
      <svg className="sn-logo-icon" style={{ width: 42, height: 42 }} viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" stroke="rgba(191,227,232,0.55)" strokeWidth="1.5" />
        <path d="M24 5 L27 21 L24 19 L21 21 Z" fill="#e23b32" />
        <path d="M24 43 L21 27 L24 29 L27 27 Z" fill="#f0f3f7" opacity=".7" />
        <path d="M5 24 L21 21 L19 24 L21 27 Z" fill="#f0f3f7" opacity=".7" />
        <path d="M43 24 L27 27 L29 24 L27 21 Z" fill="#f0f3f7" opacity=".7" />
        <circle cx="24" cy="24" r="3.5" fill="#bfe3e8" />
      </svg>
      <div className="sn-logo-text">
        <span className="sn-logo-name" style={{ fontSize: 19 }}>
          Sailing Network
        </span>
        <span className="sn-logo-tag">One Piece TCG Platform</span>
      </div>
    </div>
  );
}

interface Mode {
  id: string;
  badge: string;
  name: string;
  sub: string;
  go: string;
  view: View;
  cls: string; // picks the real card-art background (m-*)
}

const MODES: Mode[] = [
  {
    id: "board",
    badge: "Manual",
    name: "Board",
    sub: "DuelingBook-style table. You make every move.",
    go: "Open table",
    view: "board",
    cls: "m-board",
  },
  {
    id: "board2",
    badge: "Manual · alt layout",
    name: "Layout Lab",
    sub: "OPTCGSim-style arrangement of the same table.",
    go: "Open table",
    view: "board2",
    cls: "m-lab",
  },
  {
    id: "board-auto",
    badge: "Full rules · engine beta",
    name: "Play Auto",
    sub: "Engine-driven duels. Costs, battles and rules enforced.",
    go: "Play",
    view: "board-auto",
    cls: "m-auto",
  },
  {
    id: "duel-room",
    badge: "Multiplayer",
    name: "Duel Room",
    sub: "Queue up and duel other captains live.",
    go: "Enter",
    view: "duel-room",
    cls: "m-duel",
  },
];

interface Announcement {
  date: string;
  title: string;
  body: string;
  tag: string | null;
  view: View | null;
}

interface Tile {
  id: string;
  label: string;
  sub: string;
  icon: IconName;
  view: View;
  danger?: boolean;
  /** real card-art thumb (section hero crop); falls back to the icon */
  art?: string;
}

const TILES: Tile[] = [
  { id: "decks", label: "Deck Builder", sub: "Your decks & editor", icon: "deck", view: "my-decks", art: "/assets/bg/sec-decks.png" },
  { id: "popular", label: "Popular Decks", sub: "Top regional lists", icon: "trophy", view: "popular-decklists", art: "/assets/bg/sec-popular.png" },
  { id: "directory", label: "Directory", sub: "Every captain aboard", icon: "friends", view: "directory", art: "/assets/bg/sec-directory.png" },
  { id: "records", label: "Duel Records", sub: "Your match history", icon: "records", view: "records", art: "/assets/bg/sec-records.png" },
  { id: "stats", label: "Statistics", sub: "Decks & matchups", icon: "stats", view: "statistics", art: "/assets/bg/sec-statistics.png" },
  { id: "profile", label: "Profile", sub: "Your public page", icon: "profile", view: "profile-viewer", art: "/assets/bg/sec-profile.png" },
  { id: "edit", label: "Edit Profile", sub: "Avatar, bio, leader", icon: "edit", view: "edit-profile", art: "/assets/bg/sec-profile.png" },
  { id: "exit", label: "Exit", sub: "Leave the network", icon: "exit", view: "login", danger: true },
];

const fmt = (n: number) => n.toLocaleString("en-US");

export function HomePage() {
  const setView = useUiStore((s) => s.setView);
  const openProfile = useUiStore((s) => s.openProfile);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const presences = usePresenceStore((s) => s.presences);
  const fetchPresence = usePresenceStore((s) => s.fetch);

  const [stats, setStats] = useState<SiteStats | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);
  const [meta, setMeta] = useState<MetaLeader[] | null>(null);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [feed, setFeed] = useState<GlobalMessage[]>([]);
  const [news, setNews] = useState<Announcement[]>([]);
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(0);
  const [notifs, setNotifs] = useState(0);
  const [myAvatar, setMyAvatar] = useState<{ image: string | null; color: string }>({
    image: null,
    color: "#7a3030",
  });

  useEffect(() => {
    api.siteStats().then(setStats).catch(() => {});
    api.leaderboard(5).then(({ leaders }) => setBoard(leaders)).catch(() => setBoard([]));
    api.meta().then(({ leaders }) => setMeta(leaders)).catch(() => setMeta([]));
    api.myFriends().then(({ friends }) => setFriends(friends)).catch(() => {});
    api.directory().then(({ users }) => setDir(users)).catch(() => {});
    loadCardsById().then(setCards).catch(() => {});
    void fetchPresence();
    // ship's log — static versioned announcements
    fetch("/data/announcements.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((a: Announcement[]) => setNews(Array.isArray(a) ? a.slice(0, 3) : []))
      .catch(() => {});

    Promise.all([api.myProfile(), loadCardsById()])
      .then(([{ profile }, byId]) => {
        const lc = profile.favoriteLeader ? byId.get(profile.favoriteLeader) : null;
        setMyAvatar({ image: lc?.image || null, color: profile.avatarColor || "#7a3030" });
      })
      .catch(() => {});

    // one consolidated poll: badges + presence + chat tail
    const refresh = () => {
      api.chat().then(({ messages }) => setFeed(messages.slice(-4))).catch(() => {});
      api
        .sync()
        .then((s) => {
          setUnread(s.unreadMessages);
          setIncoming(s.incomingRequests);
          setNotifs(s.unreadNotifications);
        })
        .catch(() => {});
      void fetchPresence();
    };
    refresh();
    const id = window.setInterval(refresh, 6000);
    return () => window.clearInterval(id);
  }, [fetchPresence]);

  const avatarOf = (username: string) => {
    const u = dir.find((d) => d.username === username);
    return {
      color: u?.avatarColor || "#7a3030",
      image: u?.favoriteLeader ? cards?.get(u.favoriteLeader)?.image || null : null,
    };
  };

  const accepted = useMemo(() => friends.filter((f) => f.status === "accepted"), [friends]);
  const crew = useMemo(() => {
    const ranked = accepted
      .map((f) => ({ f, p: presences[f.user.id]?.status || "offline" }))
      .sort((a, b) => {
        const w = (s: string) => (s === "in_duel" ? 0 : s === "online" ? 1 : 2);
        return w(a.p) - w(b.p);
      });
    return ranked.slice(0, 6);
  }, [accepted, presences]);
  const onlineCount = useMemo(
    () => accepted.filter((f) => (presences[f.user.id]?.status || "offline") !== "offline").length,
    [accepted, presences],
  );

  /* ELO board when rated duels exist; otherwise real directory records (by wins) */
  const fallbackBoard = useMemo(
    () =>
      [...dir]
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
        .slice(0, 5)
        .filter((u) => u.wins + u.losses > 0),
    [dir],
  );
  const useFallback = board !== null && board.length === 0 && fallbackBoard.length > 0;

  const metaTop = useMemo(() => (meta || []).slice(0, 5), [meta]);
  const maxShare = useMemo(() => Math.max(1, ...metaTop.map((m) => m.share)), [metaTop]);

  const onTile = (t: Tile) => {
    if (t.id === "exit") void logout();
    else setView(t.view);
  };

  return (
    <div className="sn sn-hub">
      <header className="hu-head">
        <Logo />
        <div className="hu-head-r">
          {stats && (
            <div className="sn-pill">
              <span className="sn-livedot" /> {fmt(stats.captains)} captains aboard
            </div>
          )}
          <button className="hu-hicon" title="Messages" onClick={() => setView("messages")}>
            <Icon name="chat" size={17} />
            {unread > 0 && <span className="hu-hbadge">{unread}</span>}
          </button>
          <button className="hu-hicon" title="Notifications" onClick={() => setView("notifications")}>
            <Icon name="bell" size={17} />
            {notifs > 0 && <span className="hu-hbadge">{notifs}</span>}
          </button>
          <button className="hu-me" title="Your profile" onClick={() => openProfile(null)}>
            <LeaderAvatar
              name={user?.displayName || "?"}
              color={myAvatar.color}
              image={myAvatar.image}
              size={38}
            />
            <span>
              <span className="hu-me-name">{user?.displayName || "Captain"}</span>
              <span className="hu-me-sub">@{user?.username || ""}</span>
            </span>
          </button>
        </div>
      </header>

      {/* hero: the animated night sea with the Ship's Log in the sky */}
      <div className="hu-hero-wrap">
        <div className="hu-hero-sea" aria-hidden="true">
          <NightSea />
        </div>
        {news.length > 0 && (
          <div className="hu-log">
            <div className="hu-log-h">Ship's Log</div>
            {news.map((n) =>
              n.view ? (
                <button key={n.date + n.title} className="hu-log-row linky" onClick={() => setView(n.view!)}>
                  <span className="hu-log-date">{n.date.slice(5)}</span>
                  <span className="hu-log-main">
                    <span className="hu-log-title">{n.title}</span>
                    <span className="hu-log-body">{n.body}</span>
                  </span>
                  {n.tag && <span className="hu-log-tag">{n.tag}</span>}
                </button>
              ) : (
                <div key={n.date + n.title} className="hu-log-row">
                  <span className="hu-log-date">{n.date.slice(5)}</span>
                  <span className="hu-log-main">
                    <span className="hu-log-title">{n.title}</span>
                    <span className="hu-log-body">{n.body}</span>
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="hu-sec">
        <h2>Play</h2>
        <div className="sn-rule" />
      </div>
      <section className="hu-play">
        {MODES.map((m) => (
          <button key={m.id} className={`hu-mode ${m.cls}`} onClick={() => setView(m.view)}>
            <span className="hu-mode-badge">{m.badge}</span>
            <span className="hu-mode-name">{m.name}</span>
            <span className="hu-mode-sub">{m.sub}</span>
            <span className="hu-mode-go">
              {m.go} <Icon name="arrow" size={13} sw={2.2} />
            </span>
          </button>
        ))}
      </section>

      <div className="hu-grid">
        <main className="hu-main">
          {/* ---- live gauges ---- */}
          <section className="hu-gauges">
            <div className="hu-gauge">
              <img className="hu-gauge-art" src="/assets/bg/sec-directory.png" alt="" loading="lazy" />
              <span>
                <span className="hu-gauge-k">Captains</span>
                <span className="hu-gauge-v">{stats ? fmt(stats.captains) : "···"}</span>
              </span>
            </div>
            <div className="hu-gauge">
              <img className="hu-gauge-art" src="/assets/bg/sec-decks.png" alt="" loading="lazy" />
              <span>
                <span className="hu-gauge-k">Decks built</span>
                <span className="hu-gauge-v">{stats ? fmt(stats.decks) : "···"}</span>
              </span>
            </div>
            <div className="hu-gauge">
              <img className="hu-gauge-art" src="/assets/bg/sec-records.png" alt="" loading="lazy" />
              <span>
                <span className="hu-gauge-k">Duels logged</span>
                <span className="hu-gauge-v">{stats ? fmt(stats.matches) : "···"}</span>
              </span>
            </div>
          </section>

          {/* ---- leaderboard + meta ---- */}
          <section className="hu-data">
            <div className="hu-panel">
              <div className="hu-panel-h">
                <b>Leaderboard</b>
                <button className="hu-sec-link" onClick={() => setView("rankings")}>
                  Rankings
                </button>
              </div>
              {board === null && <div className="hu-empty">Reading the charts…</div>}
              {board?.length === 0 && !useFallback && (
                <div className="hu-empty">
                  <img src="/assets/bg/avatar-moon.png" alt="" />
                  No rated duels yet. The board fills as ranked games land.
                </div>
              )}
              {useFallback &&
                fallbackBoard.map((u, i) => (
                  <button key={u.id} className="hu-row linky" onClick={() => openProfile(u.username)}>
                    <span className={"hu-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
                    <LeaderAvatar name={u.displayName} {...avatarOf(u.username)} size={32} />
                    <span className="hu-row-name">
                      {u.displayName}
                      <span className="hu-row-sub" style={{ display: "block" }}>
                        @{u.username}
                      </span>
                    </span>
                    <span className="hu-wl">
                      <span className="w">{u.wins}W</span> <span className="l">{u.losses}L</span>
                    </span>
                    <span className="hu-num">
                      {Math.round((u.wins / Math.max(1, u.wins + u.losses)) * 100)} <small>%WR</small>
                    </span>
                  </button>
                ))}
              {board?.map((l, i) => (
                <button key={l.userId} className="hu-row linky" onClick={() => openProfile(l.username)}>
                  <span className={"hu-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
                  <LeaderAvatar name={l.displayName} {...avatarOf(l.username)} size={32} />
                  <span className="hu-row-name">{l.displayName}</span>
                  <span className="hu-wl">
                    <span className="w">{l.wins}W</span> <span className="l">{l.losses}L</span>
                  </span>
                  <span className="hu-num">
                    {Math.round(l.rating)} <small>ELO</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="hu-panel">
              <div className="hu-panel-h">
                <b>Meta leaders</b>
                <button className="hu-sec-link" onClick={() => setView("meta")}>
                  Full meta
                </button>
              </div>
              {meta === null && <div className="hu-empty">Reading the charts…</div>}
              {metaTop.length === 0 && meta !== null && (
                <div className="hu-empty">No logged matches yet this season.</div>
              )}
              {metaTop.map((m) => {
                const card = cards?.get(m.leaderId);
                return (
                  <div key={m.leaderId} className="hu-row">
                    <span className="hu-swatch">
                      {card?.image && <img src={card.image} alt="" loading="lazy" />}
                    </span>
                    <span className="hu-row-name">
                      {card?.name || m.leaderId}
                      <span className="hu-row-sub" style={{ display: "block" }}>
                        {m.winRate}% WR · {m.games} games
                      </span>
                    </span>
                    <span className="hu-share">
                      <span className="hu-share-line">
                        <span
                          style={{
                            width: `${Math.round((m.share / maxShare) * 100)}%`,
                            background: card ? cardColorHex(card) : undefined,
                          }}
                        />
                      </span>
                      <span className="hu-share-pct">{m.share}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- everything else ---- */}
          <div className="hu-sec browse">
            <h2>Browse</h2>
            <div className="sn-rule" />
          </div>
          <section className="hu-index">
            {(user?.role === "admin"
              ? [...TILES.slice(0, -1), { id: "admin", label: "Admin Panel", sub: "Accounts & bans", icon: "admin" as IconName, view: "admin" as View }, TILES[TILES.length - 1]]
              : TILES
            ).map((t) => {
              const art = t.id === "profile" ? myAvatar.image || t.art : t.art;
              return (
                <button key={t.id} className={"hu-tile" + (t.danger ? " danger" : "")} onClick={() => onTile(t)}>
                  {art ? (
                    <img className="hu-tile-art" src={art} alt="" loading="lazy" />
                  ) : (
                    <span className="hu-tile-ico">
                      <Icon name={t.icon} size={17} />
                    </span>
                  )}
                  <span>
                    <b>{t.label}</b>
                    <small>{t.sub}</small>
                  </span>
                </button>
              );
            })}
          </section>
        </main>

        {/* ---- social rail (the Dock, promoted) ---- */}
        <aside className="hu-rail">
          <div className="hu-panel">
            <div className="hu-panel-h">
              <b>Crew</b>
              <button className="hu-sec-link" onClick={() => setView("friends")}>
                {onlineCount} online · {accepted.length} friends
              </button>
            </div>
            {incoming > 0 && (
              <button className="hu-crew-row linky" onClick={() => setView("friends")}>
                <span className="hu-link-ico">
                  <Icon name="friends" size={15} />
                </span>
                <span className="hu-crew-name">Friend requests</span>
                <span className="hu-count hot">{incoming}</span>
              </button>
            )}
            {crew.map(({ f, p }) => (
              <button key={f.id} className="hu-crew-row linky" onClick={() => openProfile(f.user.username)}>
                <LeaderAvatar name={f.user.displayName} {...avatarOf(f.user.username)} size={28} />
                <span className="hu-crew-name">{f.user.displayName}</span>
                <span className="hu-crew-st">
                  {p === "in_duel" ? "in duel" : p === "online" ? "online" : "offline"}
                </span>
                <span className={`hu-crew-dot ${p}`} />
              </button>
            ))}
            {accepted.length === 0 && (
              <div className="hu-empty">
                <img src="/assets/bg/avatar-moon.png" alt="" />
                No crew yet. Find captains in the Directory.
              </div>
            )}
          </div>

          <div className="hu-panel">
            <button className="hu-link-row" onClick={() => setView("messages")}>
              <span className="hu-link-ico">
                <Icon name="chat" size={16} />
              </span>
              <b>Messages</b>
              {unread > 0 ? <span className="hu-count hot">{unread}</span> : <span className="hu-count">0</span>}
            </button>
            <button className="hu-link-row" onClick={() => setView("notifications")}>
              <span className="hu-link-ico">
                <Icon name="bell" size={16} />
              </span>
              <b>Notifications</b>
              {notifs > 0 ? <span className="hu-count hot">{notifs}</span> : <span className="hu-count">0</span>}
            </button>
          </div>

          <div className="hu-panel">
            <div className="hu-panel-h">
              <b>Global Chat</b>
            </div>
            <div className="hu-feed">
              {feed.length === 0 && (
                <div className="hu-empty">
                  <img src="/assets/bg/avatar-moon.png" alt="" />
                  Quiet on deck. Say something.
                </div>
              )}
              {feed.map((m) => (
                <div key={m.id} className="hu-feed-line">
                  <LeaderAvatar
                    name={m.displayName}
                    color={m.avatarColor}
                    image={m.favoriteLeader ? cards?.get(m.favoriteLeader)?.image || null : null}
                    size={22}
                  />
                  <span className="hu-feed-who">{m.displayName}</span>
                  <span className="hu-feed-txt">{m.body}</span>
                </div>
              ))}
              <button className="hu-feed-open" onClick={() => setView("global-chat")}>
                Join the conversation
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
