import { useEffect, useState } from "react";
import { useUiStore, type View } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type SiteStats } from "../../lib/api";
import { loadCardsById } from "../cards/cardsDb";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import "./home.css";

/* Ported from Claude design (home_layouts.jsx — "Hero Command" layout).
   Links are wired to the uiStore router instead of .html hrefs. */

const IconPaths = {
  duel: "M3 21l6-6M14 4l6 6M7 17l10-10M13 3h8v8M9 15l-2 2-4-4 2-2",
  deck: "M4 8l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  rank: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM5 6H3v2a3 3 0 003 3M19 6h2v2a3 3 0 01-3 3",
  records: "M3 5h18v14H3zM3 9h18M8 5v14M8 12l4 2-4 2v-4z",
  stats: "M3 3v18h18M8 17v-5M13 17V8M18 17v-9",
  exit: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  chat: "M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  bell: "M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  meta: "M3 3v18h18M7 14l3-3 3 3 5-6",
  friends:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  trophy:
    "M8 21h8M12 17v4M6 4h12v4a6 6 0 01-12 0V4zM6 6H3v2a3 3 0 003 3M18 6h3v2a3 3 0 01-3 3",
  admin: "M12 3l8 4v5c0 4.5-3 7.6-8 9-5-1.4-8-4.5-8-9V7l8-4zM9.5 12l1.8 1.8L15 10",
} as const;

type IconName = keyof typeof IconPaths;

function Icon({
  name,
  size = 22,
  stroke = "currentColor",
  sw = 1.8,
}: {
  name: IconName;
  size?: number;
  stroke?: string;
  sw?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={IconPaths[name]} />
    </svg>
  );
}

interface MenuItem {
  id: string;
  label: string;
  sub: string;
  icon: IconName;
  view: View;
  danger?: boolean;
}

const MENU: MenuItem[] = [
  { id: "board", label: "Play — Board", sub: "Solo practice & match sim", icon: "duel", view: "board" },
  { id: "board2", label: "Play 2 — Layout Lab", sub: "OPTCGSim-style table", icon: "duel", view: "board2" },
  { id: "deck", label: "Deck Constructor", sub: "Build & edit decks", icon: "deck", view: "my-decks" },
  { id: "directory", label: "Player Directory", sub: "Find & follow captains", icon: "friends", view: "directory" },
  { id: "friends", label: "Friends", sub: "Manage your crew", icon: "friends", view: "friends" },
  { id: "profile", label: "Profile Viewer", sub: "You & other captains", icon: "profile", view: "profile-viewer" },
  { id: "edit", label: "Edit Profile", sub: "Customize your crew", icon: "edit", view: "edit-profile" },
  { id: "rank", label: "Rankings", sub: "Climb the leaderboard", icon: "rank", view: "rankings" },
  { id: "records", label: "Duel Records", sub: "Watch replays", icon: "records", view: "records" },
  { id: "popular", label: "Popular Decks", sub: "Top regional lists", icon: "trophy", view: "popular-decklists" },
  { id: "stats", label: "My Statistics", sub: "Track your record", icon: "stats", view: "statistics" },
  { id: "messages", label: "Messages", sub: "Chat with captains", icon: "chat", view: "messages" },
  { id: "global-chat", label: "Global Chat", sub: "The crew's tavern", icon: "chat", view: "global-chat" },
  { id: "meta", label: "Meta Analytics", sub: "What's winning", icon: "meta", view: "meta" },
  { id: "notifications", label: "Notifications", sub: "Requests & replies", icon: "bell", view: "notifications" },
  { id: "exit", label: "Exit", sub: "Leave the network", icon: "exit", view: "login", danger: true },
];


function Logo() {
  return (
    <div className="sn-logo">
      <svg className="sn-logo-icon" style={{ width: 42, height: 42 }} viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" stroke="rgba(227,178,76,0.6)" strokeWidth="1.5" />
        <path d="M24 5 L27 21 L24 19 L21 21 Z" fill="#e23b32" />
        <path d="M24 43 L21 27 L24 29 L27 27 Z" fill="#e8edf4" opacity=".7" />
        <path d="M5 24 L21 21 L19 24 L21 27 Z" fill="#e8edf4" opacity=".7" />
        <path d="M43 24 L27 27 L29 24 L27 21 Z" fill="#e8edf4" opacity=".7" />
        <circle cx="24" cy="24" r="3.5" fill="#e3b24c" />
      </svg>
      <div className="sn-logo-text">
        <span className="sn-logo-name" style={{ fontSize: 19 }}>
          SAILING NETWORK
        </span>
        <span className="sn-logo-tag">One Piece TCG Platform</span>
      </div>
    </div>
  );
}

/** Original atmospheric sunset/ocean banner art (no IP). */
function BannerScene() {
  return (
    <div className="sn-scene" aria-hidden="true">
      <svg
        className="sn-scene-svg"
        viewBox="0 0 1200 360"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#241327" />
            <stop offset="0.42" stopColor="#5a2540" />
            <stop offset="0.66" stopColor="#b9523f" />
            <stop offset="0.78" stopColor="#e0894a" />
            <stop offset="0.84" stopColor="#1a3a52" />
            <stop offset="1" stopColor="#06121f" />
          </linearGradient>
          <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffe7b0" />
            <stop offset="0.45" stopColor="#ffc15e" />
            <stop offset="1" stopColor="#ff9a3c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a3a52" />
            <stop offset="1" stopColor="#06121f" />
          </linearGradient>
        </defs>
        <rect width="1200" height="360" fill="url(#sky)" />
        <g fill="#fff">
          <circle cx="120" cy="40" r="1.3" opacity="0.8" />
          <circle cx="300" cy="26" r="1" opacity="0.6" />
          <circle cx="520" cy="54" r="1.2" opacity="0.7" />
          <circle cx="940" cy="32" r="1" opacity="0.6" />
          <circle cx="1080" cy="60" r="1.4" opacity="0.8" />
          <circle cx="760" cy="22" r="1" opacity="0.5" />
          <circle cx="210" cy="70" r="0.9" opacity="0.5" />
        </g>
        <circle cx="600" cy="252" r="200" fill="url(#sun)" />
        <circle cx="600" cy="248" r="74" fill="#ffd98a" opacity="0.95" />
        <g fill="#3a1c2e" opacity="0.55">
          <ellipse cx="250" cy="150" rx="160" ry="16" />
          <ellipse cx="980" cy="120" rx="190" ry="14" />
          <ellipse cx="700" cy="98" rx="120" ry="10" />
        </g>
        <rect y="262" width="1200" height="98" fill="url(#sea)" />
        <g fill="#ffd07a" opacity="0.5">
          <rect x="560" y="270" width="80" height="3" />
          <rect x="552" y="282" width="96" height="3" />
          <rect x="544" y="296" width="112" height="4" />
          <rect x="534" y="314" width="132" height="4" />
          <rect x="520" y="334" width="160" height="5" />
        </g>
        <path d="M70 262 q40 -46 96 -46 q60 0 104 46 Z" fill="#10222e" />
        <g transform="translate(848 198)" fill="#0a151d">
          <path d="M-66 64 Q0 84 66 64 L58 74 Q0 92 -58 74 Z" />
          <rect x="-2" y="6" width="3.5" height="58" />
          <rect x="-38" y="20" width="3" height="44" />
          <rect x="34" y="24" width="3" height="40" />
          <path d="M2 8 L34 34 L2 60 Z" fill="#13212c" />
          <path d="M-2 8 L-34 34 L-2 60 Z" fill="#0c1923" />
          <path d="M36 26 L58 44 L36 60 Z" fill="#0c1923" />
          <path d="M-2 6 L-22 0 L-2 -4 Z" fill="#e23b32" />
        </g>
        <g stroke="#2a4f68" strokeWidth="2" fill="none" opacity="0.5">
          <path d="M0 300 q60 -8 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0" />
          <path d="M0 326 q60 8 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0" />
        </g>
      </svg>
    </div>
  );
}

export function HomePage() {
  const setView = useUiStore((s) => s.setView);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(0);
  const [notifs, setNotifs] = useState(0);
  const [myAvatar, setMyAvatar] = useState<{ image: string | null; color: string }>({ image: null, color: "#7a3030" });

  useEffect(() => {
    Promise.all([api.myProfile(), loadCardsById()])
      .then(([{ profile }, cards]) => {
        const lc = profile.favoriteLeader ? cards.get(profile.favoriteLeader) : null;
        setMyAvatar({ image: lc?.image || null, color: profile.avatarColor || "#7a3030" });
      })
      .catch(() => {});
    api.siteStats().then(setStats).catch(() => {});
    // one consolidated poll for all badge counts
    const refresh = () => {
      api.sync().then((s) => {
        setUnread(s.unreadMessages);
        setIncoming(s.incomingRequests);
        setNotifs(s.unreadNotifications);
      }).catch(() => {});
    };
    refresh();
    const id = window.setInterval(refresh, 6000);
    return () => window.clearInterval(id);
  }, []);

  const badgeFor = (id: string): number => (id === "messages" ? unread : id === "friends" ? incoming : id === "notifications" ? notifs : 0);

  // admins get an extra tile (inserted before Exit)
  const menu: MenuItem[] =
    user?.role === "admin"
      ? [
          ...MENU.slice(0, -1),
          { id: "admin", label: "Admin Panel", sub: "Manage accounts", icon: "admin", view: "admin" },
          MENU[MENU.length - 1],
        ]
      : MENU;

  const onTile = (m: MenuItem) => {
    if (m.id === "exit") void logout(); // clears session → App routes back to login
    else setView(m.view);
  };

  return (
    <div className="sn sn-hero">
        <header className="sn-hero-head">
          <Logo />
          <div className="sn-hero-head-r">
            <div className="sn-pill">
              <span className="sn-livedot" /> {user ? `@${user.username}` : "12,483 captains online"}
            </div>
            <LeaderAvatar name={user?.displayName || "?"} color={myAvatar.color} image={myAvatar.image} size={40} />
          </div>
        </header>

        <section className="sn-banner">
          <div className="sn-banner-art">
            <BannerScene />
            <div className="sn-banner-grad" />
          </div>
          <div className="sn-banner-copy">
            <span className="sn-kicker">Welcome back, Captain</span>
            <h1 className="sn-banner-title">
              Set sail for the
              <br />
              Grand Line
            </h1>
            <p className="sn-banner-sub">
              {stats ? `${stats.matches.toLocaleString()} duels logged · ${stats.decks} decks built · ${stats.captains} captains` : "Loading the network…"}
            </p>
            <div className="sn-banner-cta">
              <button className="sn-btn-primary" onClick={() => setView("duel-room")}>
                <Icon name="duel" size={20} stroke="#fff" /> Enter Duel Room
              </button>
              <button className="sn-btn-ghost" onClick={() => setView("records")}>
                <Icon name="records" size={18} /> Watch Records
              </button>
            </div>
          </div>
        </section>

        <section className="sn-tiles">
          {menu.map((m) => {
            const badge = badgeFor(m.id);
            return (
              <button
                key={m.id}
                onClick={() => onTile(m)}
                className={"sn-tile" + (m.danger ? " danger" : "")}
              >
                {badge > 0 && <span className="sn-tile-badge">{badge}</span>}
                <span className="sn-tile-ico">
                  <Icon name={m.icon} size={24} />
                </span>
                <span className="sn-tile-label">{m.label}</span>
                <span className="sn-tile-sub">{m.sub}</span>
              </button>
            );
          })}
        </section>

        <div className="sn-dock">
          <button className="sn-dock-btn" title="Messages" onClick={() => setView("messages")}>
            <Icon name="chat" size={22} />
            {unread > 0 && <span className="sn-dock-badge">{unread}</span>}
          </button>
          <button className="sn-dock-btn" title="Friends" onClick={() => setView("friends")}>
            <Icon name="friends" size={22} />
            {incoming > 0 && <span className="sn-dock-badge">{incoming}</span>}
            <span className="sn-dock-count">
              <span className="sn-livedot" />
              {stats ? stats.captains : "—"}
            </span>
          </button>
        </div>
    </div>
  );
}
