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
import { PixelBackdrop } from "./PixelBackdrop";
import { formatBounty } from "../stats/format";
import { useAutoStore } from "../board-auto/autoStore";
import "./home.css";
import "../profiles/profiles.css";
import { Dock } from "../profiles/ProfilePages";
import { PixelIcon, type PixelIconName } from "../pixel/PixelIcon";
import { PixelLogoMark } from "../pixel/PixelLogo";

/* Home hub — "one place for everything" (plancia di notte identity):
   Play band · live gauges · leaderboard + meta · index tiles,
   with the social dock promoted to a persistent rail. */

/* icons: the site's pixel set (features/pixel/icons.ts); names here → pixel names */
const ICON = {
  duel: "swords", board: "board", lab: "lab", gear: "gear", deck: "cards", profile: "profile",
  edit: "edit", rank: "trophy", records: "records", stats: "stats", exit: "exit", chat: "chat",
  bell: "bell", friends: "friends", trophy: "trophy", admin: "shield", arrow: "arrow", globe: "globe",
} as const satisfies Record<string, PixelIconName>;

type IconName = keyof typeof ICON;

function Icon({ name, size = 20 }: { name: IconName; size?: number; sw?: number }) {
  return <PixelIcon name={ICON[name]} size={size} />;
}

function Logo() {
  return (
    <div className="sn-logo">
      <PixelLogoMark size={42} />
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
    id: "duel-room",
    badge: "Multiplayer",
    name: "Duel Room",
    sub: "Queue up and duel other captains live.",
    go: "Enter",
    view: "duel-room",
    cls: "m-duel",
  },
  {
    id: "decks",
    badge: "Decks",
    name: "Deck Constructor",
    sub: "Build, edit and import your decks.",
    go: "Open",
    view: "my-decks",
    cls: "m-decks",
  },
  {
    id: "rankings",
    badge: "Ranked",
    name: "Leaderboard",
    sub: "Season ladder by Bounty. Climb the board.",
    go: "Open",
    view: "rankings",
    cls: "m-rank",
  },
  {
    id: "popular",
    badge: "Meta",
    name: "Popular Decks",
    sub: "Top lists from the regionals.",
    go: "Open",
    view: "popular-decklists",
    cls: "m-popular",
  },
  {
    // the Play Auto table, seat B already given to the AI
    id: "board-auto-ai",
    badge: "Full rules · AI",
    name: "Play vs Bot",
    sub: "Play against the AI — or watch two AIs play.",
    go: "Play",
    view: "board-auto",
    cls: "m-auto",
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
  { id: "meta", label: "Meta Analytics", sub: "What's winning", icon: "globe", view: "meta", art: "/assets/bg/sec-meta.png" },
  { id: "directory", label: "Directory", sub: "Every captain aboard", icon: "friends", view: "directory", art: "/assets/bg/sec-directory.png" },
  { id: "friends", label: "Friends", sub: "Manage your crew", icon: "friends", view: "friends", art: "/assets/bg/sec-friends.png" },
  { id: "messages", label: "Messages", sub: "Chat with captains", icon: "chat", view: "messages", art: "/assets/bg/sec-messages.png" },
  { id: "global-chat", label: "Global Chat", sub: "The crew's tavern", icon: "chat", view: "global-chat" },
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

  /* season Bounty ladder when it has ranked captains; otherwise real directory records (by wins) */
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
      <PixelBackdrop />
      <header className="hu-head">
        <Logo />
        <div className="hu-head-r">
          {stats && (
            <div className="sn-pill">
              <span className="sn-livedot" /> {fmt(stats.captains)} captains aboard
            </div>
          )}
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
          <button className="snp-iconbtn hu-logout" data-act="logout" title="Log out" onClick={() => void logout()}>
            <PixelIcon name="exit" size={16} /> Logout
          </button>
        </div>
      </header>

      <Dock exit={false} />

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
          <button
            key={m.id}
            className={`hu-mode ${m.cls}`}
            onClick={() => {
              if (m.view === "board-auto") useAutoStore.getState().newGame(m.id === "board-auto-ai");
              setView(m.view);
            }}
          >
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
                  No ranked captains this season yet. The board fills as games land.
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
                  <span className="hu-num">{formatBounty(l.bounty)}</span>
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
          {/* the night sky above is OGA-BY: its credit sits where people see it */}
          <footer className="hu-credits">
            Night sky: <a href="https://opengameart.org/content/moon-and-sea-pixel-art-background" target="_blank" rel="noopener noreferrer">“Moon and Sea”</a> by
            CraftPix.net (OGA-BY 3.0) ·{" "}
            <button className="hu-credits-link" onClick={() => setView("credits")}>All credits</button>
          </footer>
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
