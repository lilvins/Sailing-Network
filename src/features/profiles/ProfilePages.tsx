import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type DirectoryUser, type Match } from "../../lib/api";
import { loadLeaders, loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import "../home/home.css"; // shared .sn vars + atoms (kicker, buttons, livedot)
import "./profiles.css";
import { PixelScene } from "../pixel/PixelScene";

/* Ported from Claude design (profiles.jsx → ProfileViewer, MyProfile,
   DuelRecords, Rankings). Root is `.sn snp` so the design palette vars and
   shared atoms resolve. Links wired to the uiStore router. */

const SNP_ICON = {
  back: "M19 12H5M12 19l-7-7 7-7",
  follow: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M19 8v6M22 11h-6",
  check: "M20 6L9 17l-5-5",
  save: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z",
  help: "M12 17h.01M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 21a9 9 0 100-18 9 9 0 000 18z",
  play: "M5 3l14 9-14 9V3z",
  exit: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  chat: "M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  friends: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  plus: "M12 5v14M5 12h14",
  duel: "M3 21l6-6M14 4l6 6M7 17l10-10M13 3h8v8M9 15l-2 2-4-4 2-2",
  dot: "M12 12h.01",
} as const;

export type IconName = keyof typeof SNP_ICON;

export function Ico({ n, size = 20, sw = 1.9 }: { n: IconName; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={SNP_ICON[n]} />
    </svg>
  );
}

// Keep in sync with COLOR_HEX in features/cards/cardsDb.ts (hue-separated,
// dark-readable leader colors). K (Black) is a visible slate, not near-black.
export const HUE: Record<string, string> = { R: "#ec4d4d", G: "#29b56f", B: "#4a8ef0", P: "#b06ae6", K: "#939bad", Y: "#e6b93f" };
export type Leader = [string, string];
export const LEADERS: Leader[] = [
  ["Shanks", "R"], ["Luffy", "P"], ["Luffy", "K"], ["Uta", "G"], ["Doflamingo", "B"], ["Katakuri", "Y"],
  ["Zoro", "G"], ["Law", "R"], ["Sakazuki", "B"], ["Hancock", "P"], ["Crocodile", "K"], ["Kaido", "P"],
  ["Big Mom", "Y"], ["Whitebeard", "B"], ["Ace", "R"], ["Sabo", "G"], ["Nami", "B"], ["Robin", "P"],
  ["Chopper", "R"], ["Franky", "B"], ["Brook", "K"], ["Jinbe", "B"], ["Usopp", "G"], ["Sanji", "Y"],
  ["Yamato", "Y"], ["Smoker", "K"], ["Marco", "B"], ["Reiju", "P"], ["Perona", "P"], ["Carrot", "Y"],
  ["Bonney", "R"], ["Kid", "P"], ["Killer", "K"], ["Garp", "B"], ["Mihawk", "K"], ["Boa", "R"],
];
export const leaderColor = (h: string) => HUE[h] || "#3a4a5e";

export function PH({ name, hue, big }: { name: string; hue: string; big?: boolean }) {
  const c = leaderColor(hue);
  return (
    <div className="snp-ph">
      <div className="ph-glow" style={{ background: `radial-gradient(120% 90% at 50% 18%, ${c}cc, ${c}55 45%, #0a0f17 86%)` }} />
      <div className="ph-emblem">{name[0]}</div>
      <div className="ph-check">
        <Ico n="check" size={12} />
      </div>
      {big !== false && <div className="ph-name">{name}</div>}
    </div>
  );
}

export function Header({
  title,
  sub,
  right,
  hero,
  heroSlim,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  /** real card-art banner behind the header (public/assets/bg/sec-*.png or a card image) */
  hero?: string | null;
  /** smaller photographic accent (Messages/Friends) */
  heroSlim?: boolean;
}) {
  const setView = useUiStore((s) => s.setView);
  return (
    <header
      className={"snp-head" + (hero ? " has-hero" : "") + (heroSlim ? " slim" : "")}
      style={hero ? ({ ["--hero-img" as string]: `url("${hero}")` } as CSSProperties) : undefined}
    >
      <button className="snp-back" title="Back to Main Menu" onClick={() => setView("home")}>
        <Ico n="back" />
      </button>
      <div className="snp-head-title">
        <h1>{title}</h1>
        {sub && <span className="sn-kicker">{sub}</span>}
      </div>
      <div className="snp-head-r">
        {right}
        <HeaderDock />
      </div>
    </header>
  );
}

/** true below 1000px (phones + tablets) — the social dock then lives in the header instead of
 *  floating over the content (nothing tappable is ever covered). */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1000px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1000px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Messages + Friends shortcuts with live unread/incoming counts. */
export function DockButtons() {
  const setView = useUiStore((s) => s.setView);
  const [unread, setUnread] = useState(0);
  const [incoming, setIncoming] = useState(0);

  useEffect(() => {
    const refresh = () => {
      api.myThreads().then(({ threads }) => setUnread(threads.reduce((a, t) => a + t.unread, 0))).catch(() => {});
      api.myFriends().then(({ friends }) => setIncoming(friends.filter((f) => f.status === "pending" && f.role === "incoming").length)).catch(() => {});
    };
    refresh();
    const id = window.setInterval(refresh, 6000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      <button className="snp-iconbtn" title="Messages" onClick={() => setView("messages")}>
        <Ico n="chat" />
        {unread > 0 && <span className="snp-dock-badge">{unread}</span>}
      </button>
      <button className="snp-iconbtn" title="Friends" onClick={() => setView("friends")}>
        <Ico n="friends" />
        {incoming > 0 && <span className="snp-dock-badge">{incoming}</span>}
      </button>
    </>
  );
}

/** Floating bottom-left dock (desktop/tablet only). */
export function Dock() {
  const narrow = useNarrow();
  if (narrow) return null;
  return (
    <div className="snp-dock">
      <DockButtons />
    </div>
  );
}

/** The same shortcuts, inside the page header (narrow screens only). */
export function HeaderDock() {
  const narrow = useNarrow();
  if (!narrow) return null;
  return (
    <div className="snp-head-dock">
      <DockButtons />
    </div>
  );
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <span className="snp-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Tiny avatar for table rows / podium. */
export function Avatar2({ name, hue }: { name: string; hue: string }) {
  const c = leaderColor(hue);
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        overflow: "hidden",
        flex: "0 0 auto",
        background: `linear-gradient(150deg, ${c}, #0d1420)`,
        boxShadow: "0 0 0 2px rgba(227,178,76,0.35)",
      }}
    >
      <div className="snp-ph">
        <div className="ph-emblem" style={{ fontSize: 22, transform: "translate(-50%,-50%)" }}>
          {name[0].toUpperCase()}
        </div>
      </div>
    </div>
  );
}

/** Real leader portrait (full card art) with a colored glow fallback. */
function LeaderArt({ card, fallbackName, color }: { card?: Card | null; fallbackName?: string; color?: string }) {
  const c = color || (card ? cardColorHex(card) : "#3a4a5e");
  return (
    <div className="snp-ph">
      <div className="ph-glow" style={{ background: `radial-gradient(120% 90% at 50% 18%, ${c}cc, ${c}55 45%, #0a0f17 86%)` }} />
      {card?.image ? (
        <img
          src={card.image}
          alt={card.name}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1 }}
          draggable={false}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="ph-emblem">{(fallbackName || card?.name || "?")[0]}</div>
      )}
    </div>
  );
}

const winRatePct = (w: number, l: number) => Math.round((w / Math.max(1, w + l)) * 100);
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const tierOf = (wins: number) => (wins >= 200 ? "Yonko Tier" : wins >= 100 ? "Warlord Tier" : wins >= 40 ? "Supernova Tier" : "Rookie Tier");

/* ================= PROFILE VIEWER ================= */
interface ProfileData {
  user: { username: string; displayName: string; role: string; createdAt: number };
  profile: { bio: string; avatarColor: string; favoriteLeader: string | null; supporter: boolean; wins: number; losses: number };
  decks: { id: string; name: string; leaderId: string | null; leaderName: string; count: number; format: string; fav: boolean; wins: number; losses: number }[];
}

export function ProfileViewer() {
  const setView = useUiStore((s) => s.setView);
  const viewingUsername = useUiStore((s) => s.viewingUsername);
  const openMessagesWith = useUiStore((s) => s.openMessagesWith);
  const me = useAuthStore((s) => s.user);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [username, setUsername] = useState("");
  const [data, setData] = useState<ProfileData | null>(null);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    Promise.all([api.directory(), loadCardsById()])
      .then(([d, m]) => {
        setDir(d.users);
        setCards(m);
        const initial = viewingUsername || me?.username || d.users[0]?.username || "";
        setUsername(initial);
      })
      .catch(() => {});
  }, [me, viewingUsername]);

  useEffect(() => {
    if (!username) return;
    setData(null);
    setFollowing(false);
    api.profileOf(username).then((d) => setData(d as ProfileData)).catch(() => setData(null));
  }, [username]);

  const favCard = data?.profile.favoriteLeader && cards ? cards.get(data.profile.favoriteLeader) : null;
  const isSelf = data?.user.username === me?.username;
  const wins = data?.profile.wins ?? 0;
  const losses = data?.profile.losses ?? 0;

  return (
    <div className="sn snp px">
      <PixelScene kind="night" />
      <Header
        title="Profile Viewer"
        sub="Captain dossier"
        hero={favCard?.image || "/assets/bg/sec-profile.png"}
        right={
          <span className="snp-select" style={{ minWidth: 180 }}>
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              {dir.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.displayName} (@{u.username}){u.username === me?.username ? " — you" : ""}
                </option>
              ))}
            </select>
          </span>
        }
      />
      <div className="snp-body">
        {!data ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading captain…</div></div>
        ) : (
          <div className="snp-wrap pv-grid">
            <div className="pv-left">
              <div className="snp-frame pv-portrait">
                <div className="snp-screen">
                  <LeaderArt card={favCard} fallbackName={data.user.displayName} color={data.profile.avatarColor} />
                  <div className="snp-screen-scan" />
                </div>
              </div>
              <div className="pv-id">
                <div className="pv-username">{data.user.displayName}</div>
                <div className="pv-badges">
                  <span className="pv-badge"><span className="sn-livedot" /> {tierOf(wins)}</span>
                  {data.profile.supporter && <span className="pv-badge gold">★ Supporter</span>}
                  {data.user.role === "admin" && <span className="pv-badge gold">⚓ Admin</span>}
                </div>
              </div>
            </div>

            <div className="pv-right">
              <dl className="pv-meta">
                <dt>Username</dt>
                <dd>@{data.user.username}</dd>
                <dt>Registered</dt>
                <dd>{fmtDate(data.user.createdAt)}</dd>
                <dt>Favorite Leader</dt>
                <dd>{favCard ? `${favCard.name} (${favCard.id})` : data.profile.favoriteLeader || "—"}</dd>
                <dt>Decks</dt>
                <dd>{data.decks.length}</dd>
              </dl>

              <div className="pv-stats">
                <div className="pv-stats-h">
                  <span className="lead">Record</span>
                  <span className="col">Total</span>
                  <span className="col">Win&nbsp;rate</span>
                </div>
                <div className="pv-srow"><span className="k">Wins</span><span className="v win mono">{wins}</span><span className="v mono">{winRatePct(wins, losses)}%</span></div>
                <div className="pv-srow"><span className="k">Losses</span><span className="v loss mono">{losses}</span><span className="v mono">{wins + losses}</span></div>
              </div>

              <div>
                <div className="pv-bio-h">Profile</div>
                <div className="pv-bio">{data.profile.bio || "No bio yet."}</div>
              </div>

              {/* the captain's real decklists */}
              <div>
                <div className="pv-bio-h">Decks ({data.decks.length})</div>
                <div className="pv-decks">
                  {data.decks.length === 0 && <div className="pv-decks-empty">No decks yet.</div>}
                  {data.decks.map((d) => {
                    const lc = d.leaderId && cards ? cards.get(d.leaderId) : null;
                    const c = lc ? cardColorHex(lc) : "#3a4a5e";
                    return (
                      <div className="pv-deck" key={d.id} style={{ ["--cc" as string]: c }}>
                        {lc?.image
                          ? <img className="pv-deck-art" src={lc.image} alt="" loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                          : <span className="pv-deck-art ph" />}
                        <span className="pv-deck-info">
                          <b>{d.name}{d.fav && <span className="pv-deck-fav">★</span>}</b>
                          <small>{d.leaderName || lc?.name || "—"} · {d.count}/50 · {d.format || "—"}</small>
                        </span>
                        <span className="pv-deck-wl"><b className="w">{d.wins}W</b> · <b className="l">{d.losses}L</b></span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pv-actions">
                {isSelf ? (
                  <button className="pv-follow" onClick={() => setView("edit-profile")}>
                    <Ico n="edit" size={18} /> Edit my profile
                  </button>
                ) : (
                  <>
                    <button className={"pv-follow" + (following ? " following" : "")} onClick={() => setFollowing((v) => !v)}>
                      <Ico n="follow" size={18} /> {following ? "Following" : "Follow User"}
                    </button>
                    <button className="sn-btn-ghost" onClick={() => openMessagesWith(data.user.username)}>
                      <Ico n="chat" size={16} /> Message
                    </button>
                  </>
                )}
                <button className="sn-btn-ghost" onClick={() => setView("rankings")}>
                  <Ico n="play" size={16} /> Rankings
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Dock />
    </div>
  );
}

/* ================= MY PROFILE ================= */
export function MyProfile() {
  const setView = useUiStore((s) => s.setView);
  const me = useAuthStore((s) => s.user);

  const [leaders, setLeaders] = useState<Card[]>([]);
  const [bio, setBio] = useState("");
  const [favId, setFavId] = useState<string | null>(null);
  const [supporter, setSupporter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.myProfile(), loadLeaders()])
      .then(([{ profile }, ls]) => {
        setBio(profile.bio || "");
        setFavId(profile.favoriteLeader);
        setSupporter(profile.supporter);
        setLeaders(ls);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const favCard = leaders.find((l) => l.id === favId) || null;
  const favColor = favCard ? cardColorHex(favCard) : "#7a3030";

  const idx = leaders.findIndex((l) => l.id === favId);
  const cycle = (d: number) => {
    if (!leaders.length) return;
    const next = ((idx < 0 ? 0 : idx) + d + leaders.length) % leaders.length;
    setFavId(leaders[next].id);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.updateProfile({ bio, favoriteLeader: favId, avatarColor: favColor, supporter });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      /* ignore for now */
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="sn snp px">
        <PixelScene kind="night" />
        <Header title="My Profile" sub="Customize your captain" />
        <div className="snp-body"><div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div></div></div>
        <Dock />
      </div>
    );
  }

  return (
    <div className="sn snp px">
      <PixelScene kind="night" />
      <Header
        title="My Profile"
        sub="Customize your captain"
        hero={favCard?.image || "/assets/bg/sec-profile.png"}
        right={
          <button className="snp-iconbtn" title="View as public" onClick={() => setView("profile-viewer")}>
            <Ico n="follow" />
          </button>
        }
      />
      <div className="snp-body">
        <div className="snp-wrap mp-grid">
          <div>
            <div className="snp-frame mp-portrait">
              <button className="snp-carousel-btn prev" onClick={() => cycle(-1)} aria-label="Previous">
                <Ico n="back" size={16} />
              </button>
              <button className="snp-carousel-btn next" onClick={() => cycle(1)} aria-label="Next">
                <span style={{ transform: "rotate(180deg)", display: "flex" }}>
                  <Ico n="back" size={16} />
                </span>
              </button>
              <div className="snp-screen">
                <LeaderArt card={favCard} fallbackName={me?.displayName} color={favColor} />
              </div>
            </div>
            <div className="mp-portrait-cap">{me?.displayName || me?.username}</div>
            <div className="mp-portrait-sub">Avatar: {favCard ? favCard.name : "—"}</div>
          </div>

          <div className="mp-mid">
            <div className="mp-pick-h">
              <span>Choose Avatar (Leader)</span>
              <span className="mp-charcount">{leaders.length} leaders</span>
            </div>
            <div className="mp-grid-av">
              {leaders.map((l) => (
                <button key={l.id} className={"mp-av" + (l.id === favId ? " on" : "")} onClick={() => setFavId(l.id)} title={l.name}>
                  <LeaderArt card={l} fallbackName={l.name} />
                  <span className="ph-name">{l.name}</span>
                </button>
              ))}
            </div>

            <div className="mp-bio-h">Profile</div>
            <textarea className="mp-bio-box" value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} placeholder="Tell other captains about yourself…" />
            <div className="mp-bio-foot">
              <span className="mp-charcount">{bio.length}/280</span>
              <button className="sn-btn-primary mp-save" onClick={save} disabled={saving}>
                <Ico n={saved ? "check" : "save"} size={18} /> {saved ? "Saved!" : saving ? "Saving…" : "Save Profile"}
              </button>
            </div>
          </div>

          <div className="mp-side">
            <div className="mp-supporter">
              <div className="glow" />
              <div className="mp-supporter-k">Supporter Pass</div>
              <div className="mp-supporter-h">Hoist the Colors</div>
              <div className="mp-supporter-p">
                Show a gold ★ on your profile and in the captain directory.
              </div>
              <button className="mp-redeem" onClick={() => setSupporter((v) => !v)}>
                <Ico n={supporter ? "check" : "gift"} size={16} /> {supporter ? "Supporter enabled" : "Become a Supporter"}
              </button>
            </div>
            <div className="mp-help">
              <Ico n="help" size={16} /> Changes save to your account
            </div>
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}

/* ================= DUEL RECORDS (real match history) ================= */
export function DuelRecords() {
  const setView = useUiStore((s) => s.setView);
  const [matches, setMatches] = useState<Match[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fmt, setFmt] = useState("All Formats");

  useEffect(() => {
    Promise.all([api.myMatches(), loadCardsById()])
      .then(([{ matches }, m]) => { setMatches(matches); setCards(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const formats = useMemo(
    () => ["All Formats", ...Array.from(new Set(matches.map((m) => m.format).filter(Boolean)))],
    [matches],
  );
  const rows = useMemo(
    () => matches.filter((m) => (fmt === "All Formats" || m.format === fmt) && (!q || m.opponent.displayName.toLowerCase().includes(q.toLowerCase()))),
    [matches, fmt, q],
  );
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.length - wins;

  const lname = (id: string | null) => (id && cards?.get(id)?.name) || "—";
  const lcolor = (id: string | null) => { const c = id ? cards?.get(id) : null; return c ? cardColorHex(c) : "#3a4a5e"; };

  return (
    <div className="sn snp px">
      <PixelScene kind="sunset" />
      <Header
        title="Duel Records"
        sub="Your recent matches"
        hero="/assets/bg/sec-records.png"
        right={
          <div className="rec-summary">
            <span className="rec-chip w">Wins <span className="n">{wins}</span></span>
            <span className="rec-chip l">Losses <span className="n">{losses}</span></span>
          </div>
        }
      />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="rec-toolbar">
            <Select value={fmt} onChange={setFmt} options={formats} />
            <div className="spacer" />
            <div className="rec-search">
              <Ico n="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter opponents…" />
            </div>
          </div>

          <div className="rec-table">
            <div className="rec-head">
              <span />
              <span>Opponent</span>
              <span>Your Deck</span>
              <span>Format</span>
              <span>Result</span>
              <span className="ar">Points</span>
              <span>Opp. Leader</span>
              <span>Date</span>
              <span className="ar">Play</span>
            </div>
            {loading && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading matches…</div>}
            {!loading && rows.map((r) => (
              <div className="rec-row" key={r.id}>
                <LeaderAvatar name={r.opponent.displayName} color={lcolor(r.oppLeaderId)} image={r.oppLeaderId ? cards?.get(r.oppLeaderId)?.image : null} size={44} />
                <div className="rec-opp">
                  <span className="name">{r.opponent.displayName}</span>
                </div>
                <span className="rec-val rec-mydeck">
                  <LeaderAvatar name={r.myDeckName || "?"} color={lcolor(r.myLeaderId)} image={r.myLeaderId ? cards?.get(r.myLeaderId)?.image : null} size={30} />
                  {r.myDeckName || "—"}
                </span>
                <span>{r.format ? <span className="rec-fmt-pill">{r.format}</span> : "—"}</span>
                <span className={"rec-res " + (r.result === "win" ? "win" : "lose")}>{r.result === "win" ? "WIN" : "LOSE"}</span>
                <span className={"rec-pts " + (r.points >= 0 ? "up" : "down")}>{r.points >= 0 ? "+" : ""}{r.points}</span>
                <span className="rk-lead"><span className="rk-leaddot" style={{ background: lcolor(r.oppLeaderId) }} />{lname(r.oppLeaderId)}</span>
                <span className="rec-date">{fmtDate(r.createdAt)}</span>
                <span className="rec-new">{r.onPlay ? "1st" : "2nd"}</span>
              </div>
            ))}
            {!loading && rows.length === 0 && <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>No duels match your filter.</div>}
          </div>

          <div className="rec-foot">
            <button className="rec-exit" onClick={() => setView("home")}>
              <Ico n="exit" size={16} /> Exit to Main Menu
            </button>
            <span className="mp-charcount">Showing {rows.length} of your {matches.length} most recent duels</span>
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}

/* ================= RANKINGS ================= */
interface RankedCaptain {
  rank: number;
  username: string;
  displayName: string;
  wins: number;
  losses: number;
  leaderName: string;
  leaderColor: string;
  leaderImage: string | null;
  rating: number;
  deckCount: number;
  you: boolean;
}

const ratingOf = (w: number, l: number) => Math.max(0, 1000 + w * 6 - l * 3);

function RankRow({ r }: { r: RankedCaptain }) {
  const wr = winRatePct(r.wins, r.losses);
  return (
    <div className={"rec-row rk-row" + (r.you ? " me" : "")}>
      <span className={"rk-rank r" + (r.rank <= 3 ? r.rank : "")}>{r.rank}</span>
      <div className="rec-opp">
        <LeaderAvatar name={r.displayName} color={r.leaderColor} image={r.leaderImage} size={48} />
        <span className="name">
          {r.displayName}
          {r.you && <span className="rk-youtag">YOU</span>}
        </span>
      </div>
      <span className="rk-lead">
        <span className="rk-leaddot" style={{ background: r.leaderColor }} />
        {r.leaderName}
      </span>
      <span className="rk-wr">
        <span className="rk-wr-bar">
          <span className="rk-wr-fill" style={{ width: wr + "%", background: wr >= 50 ? "linear-gradient(90deg,#1f8a5b,#46c98a)" : "linear-gradient(90deg,#9a3b34,#e26a62)" }} />
        </span>
        <span className="rk-wr-num">{wr}%</span>
      </span>
      <span className="rec-new">{r.rating}</span>
      <span className="rk-record">
        <b className="win">{r.wins}</b> – <b className="loss">{r.losses}</b>
      </span>
      <span className="rk-streak up">{r.deckCount}</span>
    </div>
  );
}

export function Rankings() {
  const setView = useUiStore((s) => s.setView);
  const me = useAuthStore((s) => s.user);
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);

  useEffect(() => {
    Promise.all([api.directory(), loadCardsById()])
      .then(([d, m]) => { setDir(d.users); setCards(m); })
      .catch(() => {});
  }, []);

  const ranked: RankedCaptain[] = useMemo(() => {
    return dir
      .map((u) => {
        const lc = u.favoriteLeader && cards ? cards.get(u.favoriteLeader) : null;
        return {
          username: u.username,
          displayName: u.displayName,
          wins: u.wins,
          losses: u.losses,
          leaderName: lc?.name || "—",
          leaderColor: lc ? cardColorHex(lc) : "#3a4a5e",
          leaderImage: lc?.image || null,
          rating: ratingOf(u.wins, u.losses),
          deckCount: u.deckCount,
          you: u.username === me?.username,
          rank: 0,
        };
      })
      .sort((a, b) => b.rating - a.rating)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [dir, cards, me]);

  const rows = useMemo(
    () => ranked.filter((r) => !q || r.displayName.toLowerCase().includes(q.toLowerCase()) || r.username.toLowerCase().includes(q.toLowerCase())),
    [q, ranked],
  );
  const mine = ranked.find((r) => r.you);
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);

  return (
    <div className="sn snp px">
      <PixelScene kind="sunset" />
      <Header
        title="Rankings"
        sub="Captain leaderboard"
        hero="/assets/bg/sec-rankings.png"
        right={
          mine && (
            <div className="rk-myrank">
              <span className="rk-myrank-k">Your rank</span>
              <span className="rk-myrank-v">#{mine.rank}</span>
            </div>
          )
        }
      />
      <div className="snp-body">
        <div className="snp-wrap">
          {podium.length === 3 && (
            <div className="rk-podium">
              {podium.map((p) => (
                <div key={p.username} className={"rk-pod rk-pod-" + p.rank}>
                  <div className="rk-pod-medal">{p.rank}</div>
                  <div className="rk-pod-av">
                    <LeaderAvatar name={p.displayName} color={p.leaderColor} image={p.leaderImage} fill />
                  </div>
                  <div className="rk-pod-name">{p.displayName}</div>
                  <div className="rk-pod-elo">
                    {p.rating} <span>PTS</span>
                  </div>
                  <div className="rk-pod-meta">
                    <span className="rk-pod-wr">{winRatePct(p.wins, p.losses)}% WR</span>
                    <span className="rk-pod-lead">
                      <span className="rk-leaddot" style={{ background: p.leaderColor }} />
                      {p.leaderName}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rec-toolbar">
            <div className="spacer" />
            <div className="rec-search">
              <Ico n="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a captain…" />
            </div>
          </div>

          {mine && (
            <div className="rk-pinned-wrap">
              <div className="rk-pinned-label">Your standing</div>
              <div className="rec-table rk-pinned">
                <RankRow r={mine} />
              </div>
            </div>
          )}

          <div className="rec-table">
            <div className="rec-head rk-head">
              <span className="ar">#</span>
              <span>Captain</span>
              <span>Favorite Leader</span>
              <span>Win Rate</span>
              <span className="ar">Rating</span>
              <span className="ar">W – L</span>
              <span className="ar">Decks</span>
            </div>
            {rows.map((r) => (
              <RankRow key={r.username} r={r} />
            ))}
            {rows.length === 0 && <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>No captains match your search.</div>}
          </div>

          <div className="rec-foot">
            <button className="rec-exit" onClick={() => setView("home")}>
              <Ico n="exit" size={16} /> Exit to Main Menu
            </button>
            <span className="mp-charcount">{ranked.length} captains</span>
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}
