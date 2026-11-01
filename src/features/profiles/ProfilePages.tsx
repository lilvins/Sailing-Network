import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type Match } from "../../lib/api";
import { COUNTRIES, countryName } from "../stats/format";
import { loadLeaders, loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import "../home/home.css"; // shared .sn vars + atoms (kicker, buttons, livedot)
import "./profiles.css";
import { PixelScene } from "../pixel/PixelScene";
import { PixelIcon, type PixelIconName } from "../pixel/PixelIcon";

/* Ported from Claude design (profiles.jsx → MyProfile, DuelRecords; the
   Profile Viewer and Rankings live in ProfileViewer.tsx / Rankings.tsx). Root is `.sn snp` so the design palette vars and
   shared atoms resolve. Links wired to the uiStore router. */

/* icons: the site's pixel set (features/pixel/icons.ts); names here → pixel names */
const SNP_ICON = {
  back: "back", follow: "follow", check: "check", save: "save", gift: "gift", help: "help",
  play: "play", exit: "exit", chat: "chat", friends: "friends", search: "search", edit: "edit",
  send: "send", plus: "plus", duel: "swords", dot: "dot",
} as const satisfies Record<string, PixelIconName>;

export type IconName = keyof typeof SNP_ICON;

export function Ico({ n, size = 20 }: { n: IconName; size?: number; sw?: number }) {
  return <PixelIcon name={SNP_ICON[n]} size={size} />;
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
export function LeaderArt({ card, fallbackName, color }: { card?: Card | null; fallbackName?: string; color?: string }) {
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

export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/* ================= MY PROFILE ================= */
export function MyProfile() {
  const setView = useUiStore((s) => s.setView);
  const me = useAuthStore((s) => s.user);

  const [leaders, setLeaders] = useState<Card[]>([]);
  const [bio, setBio] = useState("");
  const [favId, setFavId] = useState<string | null>(null);
  const [supporter, setSupporter] = useState(false);
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.myProfile(), loadLeaders()])
      .then(([{ profile }, ls]) => {
        setBio(profile.bio || "");
        setFavId(profile.favoriteLeader);
        setSupporter(profile.supporter);
        setCountry(profile.country || "");
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
      await api.updateProfile({ bio, favoriteLeader: favId, avatarColor: favColor, supporter, country });
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

            <div className="mp-bio-h">Country</div>
            <span className="snp-select mp-country">
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Not shown</option>
                {[...COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b))).map((c) => (
                  <option key={c} value={c}>{countryName(c)}</option>
                ))}
              </select>
            </span>
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
