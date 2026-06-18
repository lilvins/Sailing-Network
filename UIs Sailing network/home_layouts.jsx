/* ===========================================================
   Sailing Network — Main Menu layout prototypes
   Layout B — Hero Command (locked in).
   Exports: window.HomeLayouts = { Hero }
   =========================================================== */
const { useState } = React;

/* ---------- icon set (compact line icons) ---------- */
const IconPaths = {
  duel:    "M3 21l6-6M14 4l6 6M7 17l10-10M13 3h8v8M9 15l-2 2-4-4 2-2",
  deck:    "M4 8l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  edit:    "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  rank:    "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM5 6H3v2a3 3 0 003 3M19 6h2v2a3 3 0 01-3 3",
  records: "M3 5h18v14H3zM3 9h18M8 5v14M8 12l4 2-4 2v-4z",
  stats:   "M3 3v18h18M8 17v-5M13 17V8M18 17v-9",
  exit:    "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  chat:    "M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  friends: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
};
function Icon({ name, size = 22, stroke = "currentColor", sw = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={IconPaths[name]}></path>
    </svg>);
}

/* ---------- menu model ---------- */
const MENU = [
  { id: "duel",    label: "Duel Room",        sub: "Play a match",        icon: "duel",    primary: true, href: "Duel Room.html" },
  { id: "deck",    label: "Deck Constructor", sub: "Build & edit decks",  icon: "deck",    href: "#" },
  { id: "profile", label: "Profile Viewer",   sub: "You & other captains",icon: "profile", href: "Profile Viewer.html" },
  { id: "edit",    label: "Edit Profile",     sub: "Customize your crew",  icon: "edit",    href: "My Profile.html" },
  { id: "rank",    label: "Rankings",         sub: "Climb the leaderboard",icon: "rank",    href: "Rankings.html" },
  { id: "records", label: "Duel Records",     sub: "Watch replays",        icon: "records", href: "Duel Records.html" },
  { id: "stats",   label: "My Statistics",    sub: "Track your record",    icon: "stats",   href: "#" },
  { id: "exit",    label: "Exit",             sub: "Leave the network",    icon: "exit",   danger: true, href: "Sailing Network.html" },
];





/* small shared bits ------------------------------------------------ */
function Avatar({ color, size = 40, ring = "rgba(227,178,76,0.5)" }) {
  return (
    <div className="sn-avatar" style={{ width: size, height: size, background: `linear-gradient(150deg, ${color}, #0d1420)`, boxShadow: `0 0 0 2px ${ring}, 0 4px 10px rgba(0,0,0,0.5)` }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="rgba(255,255,255,0.55)"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0z"></path></svg>
    </div>);
}
function Logo({ small }) {
  return (
    <div className="sn-logo">
      <svg className="sn-logo-icon" style={{ width: small ? 30 : 42, height: small ? 30 : 42 }} viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" stroke="rgba(227,178,76,0.6)" strokeWidth="1.5"></circle>
        <path d="M24 5 L27 21 L24 19 L21 21 Z" fill="#e23b32"></path>
        <path d="M24 43 L21 27 L24 29 L27 27 Z" fill="#e8edf4" opacity=".7"></path>
        <path d="M5 24 L21 21 L19 24 L21 27 Z" fill="#e8edf4" opacity=".7"></path>
        <path d="M43 24 L27 27 L29 24 L27 21 Z" fill="#e8edf4" opacity=".7"></path>
        <circle cx="24" cy="24" r="3.5" fill="#e3b24c"></circle>
      </svg>
      <div className="sn-logo-text">
        <span className="sn-logo-name" style={{ fontSize: small ? 15 : 19 }}>SAILING NETWORK</span>
        {!small && <span className="sn-logo-tag">One Piece TCG Platform</span>}
      </div>
    </div>);
}

/* ---------- One Piece–themed atmospheric banner scene (original art, no IP) ---------- */
function BannerScene() {
  return (
    <div className="sn-scene" aria-hidden="true">
      <svg className="sn-scene-svg" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#241327"></stop>
            <stop offset="0.42" stopColor="#5a2540"></stop>
            <stop offset="0.66" stopColor="#b9523f"></stop>
            <stop offset="0.78" stopColor="#e0894a"></stop>
            <stop offset="0.84" stopColor="#1a3a52"></stop>
            <stop offset="1" stopColor="#06121f"></stop>
          </linearGradient>
          <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffe7b0"></stop>
            <stop offset="0.45" stopColor="#ffc15e"></stop>
            <stop offset="1" stopColor="#ff9a3c" stopOpacity="0"></stop>
          </radialGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a3a52"></stop>
            <stop offset="1" stopColor="#06121f"></stop>
          </linearGradient>
        </defs>
        <rect width="1200" height="360" fill="url(#sky)"></rect>
        {/* stars */}
        <g fill="#fff">
          <circle cx="120" cy="40" r="1.3" opacity="0.8"></circle>
          <circle cx="300" cy="26" r="1" opacity="0.6"></circle>
          <circle cx="520" cy="54" r="1.2" opacity="0.7"></circle>
          <circle cx="940" cy="32" r="1" opacity="0.6"></circle>
          <circle cx="1080" cy="60" r="1.4" opacity="0.8"></circle>
          <circle cx="760" cy="22" r="1" opacity="0.5"></circle>
          <circle cx="210" cy="70" r="0.9" opacity="0.5"></circle>
        </g>
        {/* sun glow */}
        <circle cx="600" cy="252" r="200" fill="url(#sun)"></circle>
        <circle cx="600" cy="248" r="74" fill="#ffd98a" opacity="0.95"></circle>
        {/* clouds */}
        <g fill="#3a1c2e" opacity="0.55">
          <ellipse cx="250" cy="150" rx="160" ry="16"></ellipse>
          <ellipse cx="980" cy="120" rx="190" ry="14"></ellipse>
          <ellipse cx="700" cy="98" rx="120" ry="10"></ellipse>
        </g>
        {/* sea */}
        <rect y="262" width="1200" height="98" fill="url(#sea)"></rect>
        {/* sun reflection */}
        <g fill="#ffd07a" opacity="0.5">
          <rect x="560" y="270" width="80" height="3"></rect>
          <rect x="552" y="282" width="96" height="3"></rect>
          <rect x="544" y="296" width="112" height="4"></rect>
          <rect x="534" y="314" width="132" height="4"></rect>
          <rect x="520" y="334" width="160" height="5"></rect>
        </g>
        {/* distant island */}
        <path d="M70 262 q40 -46 96 -46 q60 0 104 46 Z" fill="#10222e"></path>
        {/* pirate ship silhouette on the horizon */}
        <g transform="translate(848 198)" fill="#0a151d">
          <path d="M-66 64 Q0 84 66 64 L58 74 Q0 92 -58 74 Z"></path>
          <rect x="-2" y="6" width="3.5" height="58"></rect>
          <rect x="-38" y="20" width="3" height="44"></rect>
          <rect x="34" y="24" width="3" height="40"></rect>
          {/* sails */}
          <path d="M2 8 L34 34 L2 60 Z" fill="#13212c"></path>
          <path d="M-2 8 L-34 34 L-2 60 Z" fill="#0c1923"></path>
          <path d="M36 26 L58 44 L36 60 Z" fill="#0c1923"></path>
          {/* flag */}
          <path d="M-2 6 L-22 0 L-2 -4 Z" fill="#e23b32"></path>
        </g>
        {/* gentle wave lines */}
        <g stroke="#2a4f68" strokeWidth="2" fill="none" opacity="0.5">
          <path d="M0 300 q60 -8 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0"></path>
          <path d="M0 326 q60 8 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0"></path>
        </g>
      </svg>
    </div>);
}

/* =================================================================
   LAYOUT B — HERO COMMAND  (featured play + tile grid)
   ================================================================= */
function Hero() {
  return (
    <div className="sn sn-hero">
      <header className="sn-hero-head">
        <Logo />
        <div className="sn-hero-head-r">
          <div className="sn-pill"><span className="sn-livedot"></span> 12,483 captains online</div>
          <Avatar color="#7a3030" size={40} />
        </div>
      </header>

      {/* Featured banner */}
      <section className="sn-banner">
        <div className="sn-banner-art">
          <BannerScene />
          <image-slot id="home-hero-b" shape="rounded" radius="18" placeholder="Drop hero art"></image-slot>
          <div className="sn-banner-grad"></div>
        </div>
        <div className="sn-banner-copy">
          <span className="sn-kicker">Welcome back, Captain</span>
          <h1 className="sn-banner-title">Set sail for the<br/>Grand Line</h1>
          <p className="sn-banner-sub">3,201 duels played today · Season 6 ends in 11 days</p>
          <div className="sn-banner-cta">
            <a className="sn-btn-primary" href="Duel Room.html"><Icon name="duel" size={20} stroke="#fff" /> Enter Duel Room</a>
            <a className="sn-btn-ghost" href="Duel Records.html"><Icon name="records" size={18} /> Watch Records</a>
          </div>
        </div>
      </section>

      {/* Tile grid */}
      <section className="sn-tiles">
        {MENU.filter((m) => m.id !== "duel").map((m) => (
          <a key={m.id} href={m.href} className={"sn-tile" + (m.danger ? " danger" : "")}>
            <span className="sn-tile-ico"><Icon name={m.icon} size={24} /></span>
            <span className="sn-tile-label">{m.label}</span>
            <span className="sn-tile-sub">{m.sub}</span>
          </a>
        ))}
      </section>

      {/* corner dock — messages + online players */}
      <div className="sn-dock">
        <button className="sn-dock-btn" title="Messages">
          <Icon name="chat" size={22} />
          <span className="sn-dock-badge">3</span>
        </button>
        <button className="sn-dock-btn" title="Online players">
          <Icon name="friends" size={22} />
          <span className="sn-dock-count"><span className="sn-livedot"></span>128</span>
        </button>
      </div>
    </div>);
}

window.HomeLayouts = { Hero };
