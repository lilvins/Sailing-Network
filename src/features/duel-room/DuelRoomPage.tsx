import { useEffect, useRef, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { api, type Deck, type QueueStatus } from "../../lib/api";
import { loadCardsById, type Card } from "../cards/cardsDb";
import "../home/home.css"; // shared .sn atoms (logo, pill, avatar, livedot, vars)
import "@fontsource/silkscreen/400.css"; // pixel HUD labels (--hud in duelroom.css)
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css"; // pixel duelist names (--pixel)
import "./duelroom.css";

/* Ported from Claude design (duelroom.jsx). Fluid + responsive; links wired to
   the uiStore router. */

const DR_ICONS = {
  duel: "M3 21l6-6M14 4l6 6M7 17l10-10M13 3h8v8M9 15l-2 2-4-4 2-2",
  watch: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4",
  host: "M12 5v14M5 12h14",
  back: "M19 12H5M12 19l-7-7 7-7",
  chat: "M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  friends:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  sound: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13",
  caret: "M6 9l6 6 6-6",
  exit: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
} as const;

type IconName = keyof typeof DR_ICONS;

function Icon({ name, size = 22, stroke = "currentColor", sw = 1.8 }: { name: IconName; size?: number; stroke?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={DR_ICONS[name]} />
    </svg>
  );
}

function Logo() {
  return (
    <div className="sn-logo">
      <svg className="sn-logo-icon" style={{ width: 38, height: 38 }} viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" stroke="rgba(227,178,76,0.6)" strokeWidth="1.5" />
        <path d="M24 5 L27 21 L24 19 L21 21 Z" fill="#e23b32" />
        <path d="M24 43 L21 27 L24 29 L27 27 Z" fill="#e8edf4" opacity=".7" />
        <path d="M5 24 L21 21 L19 24 L21 27 Z" fill="#e8edf4" opacity=".7" />
        <path d="M43 24 L27 27 L29 24 L27 21 Z" fill="#e8edf4" opacity=".7" />
        <circle cx="24" cy="24" r="3.5" fill="#e3b24c" />
      </svg>
      <div className="sn-logo-text">
        <span className="sn-logo-name" style={{ fontSize: 16 }}>
          SAILING NETWORK
        </span>
        <span className="sn-logo-tag">Duel Room</span>
      </div>
    </div>
  );
}

function Avatar({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <div
      className="sn-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, ${color}, #0d1420)`,
        boxShadow: "0 0 0 2px rgba(227,178,76,0.45), 0 4px 10px rgba(0,0,0,0.5)",
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="rgba(255,255,255,0.55)">
        <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0z" />
      </svg>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="dr-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="dr-select-caret">
        <Icon name="caret" size={16} />
      </span>
    </div>
  );
}

// LogResult modal — lets the player record a win/loss for local or test duels
interface LogResultProps {
  decks: Deck[];
  cards: Map<string, Card> | null;
  onClose: () => void;
}
function LogResultModal({ decks, onClose }: LogResultProps) {
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [result, setResult] = useState<"win" | "loss">("win");
  const [onPlay, setOnPlay] = useState(true);
  const [oppLeader, setOppLeader] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!deckId || saving) return;
    setSaving(true);
    try {
      await api.logMatch({ deckId, result, onPlay, oppLeaderId: oppLeader || null });
      setDone(true);
      setTimeout(onClose, 900);
    } catch {
      setSaving(false);
    }
  };

  if (done) return (
    <div className="dr-modal-overlay">
      <div className="dr-modal" style={{ textAlign: "center", gap: 12 }}>
        <span style={{ fontSize: 32 }}>{result === "win" ? "🏆" : "💀"}</span>
        <div style={{ color: "var(--text)", fontWeight: 700 }}>Result logged!</div>
      </div>
    </div>
  );

  return (
    <div className="dr-modal-overlay" onClick={onClose}>
      <div className="dr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dr-modal-head">
          <span className="dr-modal-title"><Icon name="duel" size={16} stroke="#e3b24c" /> Log Duel Result</span>
          <button className="dr-modal-x" onClick={onClose}>×</button>
        </div>
        <div className="dr-field">
          <label>Deck used</label>
          <div className="dr-select">
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className="dr-select-caret"><Icon name="caret" size={16} /></span>
          </div>
        </div>
        <div className="dr-field">
          <label>Result</label>
          <div className="dr-mode">
            <button className={"dr-radio" + (result === "win" ? " on" : "")} onClick={() => setResult("win")}>
              <span className="dr-dot" /> Win
            </button>
            <button className={"dr-radio" + (result === "loss" ? " on" : "")} onClick={() => setResult("loss")}>
              <span className="dr-dot" /> Loss
            </button>
          </div>
        </div>
        <div className="dr-field">
          <label>Turn order</label>
          <div className="dr-mode">
            <button className={"dr-radio" + (onPlay ? " on" : "")} onClick={() => setOnPlay(true)}>
              <span className="dr-dot" /> Going 1st
            </button>
            <button className={"dr-radio" + (!onPlay ? " on" : "")} onClick={() => setOnPlay(false)}>
              <span className="dr-dot" /> Going 2nd
            </button>
          </div>
        </div>
        <div className="dr-field">
          <label>Opponent leader <small>(optional)</small></label>
          <input
            className="dr-input"
            value={oppLeader}
            onChange={(e) => setOppLeader(e.target.value)}
            placeholder="e.g. OP01-001"
          />
        </div>
        <button className="dr-host-btn" onClick={save} disabled={!deckId || saving}>
          {saving ? "Saving…" : "Log Result"}
        </button>
      </div>
    </div>
  );
}

interface Duel {
  host: string;
  art: string;
  elo: number;
  type: string;
  leader: string;
  watchers: number;
  locked: boolean;
  note: string;
}
interface Format {
  key: string;
  name: string;
  accent: string;
  duels: Duel[];
}

const FORMATS: Format[] = [
  {
    key: "op16",
    name: "Standard · OP16",
    accent: "#3f9d7e",
    duels: [
      { host: "GearFifth", art: "#2f5e44", elo: 2350, type: "BO1", leader: "Black Luffy", watchers: 12, locked: false, note: "ft me" },
      { host: "NavigatorNami", art: "#3a4a5e", elo: 2288, type: "BO3", leader: "Blue Doflamingo", watchers: 4, locked: true, note: "ask for pw" },
      { host: "RogerPirate", art: "#7a3030", elo: 1990, type: "BO1", leader: "Red Shanks", watchers: 0, locked: false, note: "casual" },
      { host: "BrookSoul", art: "#5b2a78", elo: 1740, type: "BO3", leader: "Purple Luffy", watchers: 2, locked: false, note: "" },
    ],
  },
  {
    key: "op15",
    name: "Standard · OP15",
    accent: "#c98a52",
    duels: [
      { host: "KingOfHearts", art: "#7a2b5a", elo: 2391, type: "BO3", leader: "Yellow Katakuri", watchers: 8, locked: false, note: "BO3 plz" },
      { host: "SwordHawk", art: "#2a5e6e", elo: 2210, type: "BO3", leader: "Green Zoro", watchers: 1, locked: true, note: "" },
      { host: "FrankyShip", art: "#b06a1f", elo: 1880, type: "BO1", leader: "Red-Green Law", watchers: 3, locked: false, note: "for fun" },
    ],
  },
  {
    key: "eastblue",
    name: "East Blue",
    accent: "#9a6ad0",
    duels: [
      { host: "ZoroSan", art: "#2f5e44", elo: 1620, type: "BO1", leader: "Starter Zoro", watchers: 0, locked: false, note: "new player" },
      { host: "UsoppKing", art: "#b06a1f", elo: 1480, type: "BO1", leader: "Starter Luffy", watchers: 1, locked: false, note: "learning" },
    ],
  },
];

function DuelRow({ d, mode }: { d: Duel; mode: string }) {
  return (
    <div className="dr-duel">
      <Avatar color={d.art} size={36} />
      <div className="dr-duel-main">
        <div className="dr-duel-top">
          <span className="dr-duel-host">{d.host}</span>
          {d.locked && (
            <span className="dr-duel-lock">
              <Icon name="lock" size={12} />
            </span>
          )}
          <span className="dr-duel-elo">{d.elo}</span>
        </div>
        <div className="dr-duel-meta">
          <span>{d.type}</span>
          <span className="dot">·</span>
          <span>{d.leader}</span>
          {d.note && (
            <>
              <span className="dot">·</span>
              <span className="dr-duel-note">“{d.note}”</span>
            </>
          )}
        </div>
      </div>
      <span className="dr-duel-watch">
        <Icon name="watch" size={13} /> {d.watchers}
      </span>
      <button className={"dr-join" + (mode === "watch" ? " watch" : "")}>
        {mode === "watch" ? "Watch" : "Join"}
      </button>
    </div>
  );
}

export function DuelRoomPage() {
  const setView = useUiStore((s) => s.setView);

  // real decks
  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [deckId, setDeckId] = useState("");
  const [showLogResult, setShowLogResult] = useState(false);

  useEffect(() => {
    Promise.all([api.myDecks(), loadCardsById()])
      .then(([{ decks }, cardMap]) => {
        setMyDecks(decks);
        setCards(cardMap);
        if (decks.length) setDeckId(decks[0].id);
      })
      .catch(() => {});
  }, []);

  const [mode, setMode] = useState("duel");
  const [poolFormat, setPoolFormat] = useState("Standard · OP16 (Rated)");
  const [poolRules, setPoolRules] = useState("EN");
  const [poolType, setPoolType] = useState("BO3");
  const [inPool, setInPool] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);

  // poll queue status while in pool
  useEffect(() => {
    if (!inPool) { setQueueStatus(null); return; }
    const poll = async () => {
      try {
        const s = await api.queueStatus();
        setQueueStatus(s);
        if (s.status === "matched") {
          setInPool(false);
          setView("board"); // navigate to board when matched
        }
      } catch { /* silent */ }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => window.clearInterval(id);
  }, [inPool, setView]);

  const togglePool = async () => {
    if (inPool) {
      try { await api.leaveQueue(); } catch { /* silent */ }
      setInPool(false);
    } else {
      if (!deckId) return;
      try {
        await api.joinQueue(deckId);
        setInPool(true);
      } catch (e) {
        console.error("Join queue failed", e);
      }
    }
  };

  const [fUser, setFUser] = useState("");
  const [fCard, setFCard] = useState("");
  const [fMatch, setFMatch] = useState("Any");
  const [fSort, setFSort] = useState("Rating");

  const [hFormat, setHFormat] = useState("Standard · OP16");
  const [hType, setHType] = useState("Best of 3");
  const [hNote, setHNote] = useState("");
  const [hPass, setHPass] = useState("");
  const [watching, setWatching] = useState(true);
  const [wNote, setWNote] = useState("");
  const [wPass, setWPass] = useState("");

  const trackRef = useRef<HTMLDivElement>(null);
  const scrollFmt = (dir: number) => {
    if (trackRef.current) trackRef.current.scrollBy({ left: dir * 330, behavior: "smooth" });
  };

  const filterDuels = (duels: Duel[]) => {
    let r = duels.filter((d) => d.host.toLowerCase().includes(fUser.toLowerCase()));
    if (fMatch !== "Any") r = r.filter((d) => d.type === fMatch);
    r = [...r].sort((a, b) =>
      fSort === "Rating" ? b.elo - a.elo : fSort === "Watchers" ? b.watchers - a.watchers : a.host.localeCompare(b.host),
    );
    return r;
  };

  return (
    <div className="sn dr">
      {/* pixel-art sunset over the sea behind the room (CraftPix, OGA-BY 3.0 — CREDITS.md) */}
      <div className="dr-scene" aria-hidden="true">
        <i className="sky" />
        <i className="cloud" />
        <i className="reflection" />
        <i className="shade" />
      </div>
      <header className="dr-head">
        <div className="dr-head-l">
          <button className="dr-back" title="Back to menu" onClick={() => setView("home")}>
            <Icon name="back" size={18} />
          </button>
          <Logo />
        </div>
        <h1 className="dr-title">Duel Room</h1>
        <div className="dr-head-r">
          <div className="sn-pill">
            <span className="sn-livedot" /> 12,483 online
          </div>
          <Avatar color="#2f5e44" size={36} />
        </div>
      </header>

      <section className="dr-top">
        <div className="dr-pool card">
          <div className="dr-card-h">
            <Icon name="duel" size={17} stroke="#e3b24c" />
            <span>Duelist Pool</span>
          </div>
          <p className="dr-pool-desc">
            Join the pool and we'll find a duelist near your skill level, given your constraints.
          </p>
          <div className="dr-field">
            <label>Format</label>
            <Select value={poolFormat} onChange={setPoolFormat} options={["Standard · OP16 (Rated)", "Standard · OP16", "Standard · OP15", "East Blue"]} />
          </div>
          <div className="dr-field">
            <label>Region</label>
            <Select value={poolRules} onChange={setPoolRules} options={["EN", "JP", "EN + JP"]} />
          </div>
          <div className="dr-field">
            <label>Type</label>
            <Select value={poolType} onChange={setPoolType} options={["BO3", "BO1", "BO5"]} />
          </div>
          <button className={"dr-pool-btn" + (inPool ? " active" : "")} onClick={togglePool}>
            {inPool ? "Searching… cancel" : "Join Pool"}
          </button>
          {inPool && (
            <div className="dr-pool-status">
              <span className="dr-spinner" />
              {queueStatus?.status === "waiting"
                ? `Position ${queueStatus.position} · ${queueStatus.estimatedWait ?? "wait unknown"}`
                : "Finding a worthy opponent…"}
            </div>
          )}
        </div>

        <div className="dr-open">
          <div className="dr-open-head">
            <span className="dr-open-title">Open Duels</span>
            <div className="dr-open-arrows">
              <button onClick={() => scrollFmt(-1)} aria-label="Scroll left">
                <Icon name="caret" size={16} />
              </button>
              <button onClick={() => scrollFmt(1)} aria-label="Scroll right">
                <Icon name="caret" size={16} />
              </button>
            </div>
          </div>
          <div className="dr-track" ref={trackRef}>
            {FORMATS.map((f) => {
              const list = filterDuels(f.duels);
              return (
                <div className="dr-fmt card" key={f.key}>
                  <div className="dr-fmt-h" style={{ borderColor: f.accent }}>
                    <span className="dr-fmt-dot" style={{ background: f.accent }} />
                    <span className="dr-fmt-name">{f.name}</span>
                    <span className="dr-fmt-count">{list.length}</span>
                  </div>
                  <div className="dr-fmt-list">
                    {list.length ? (
                      list.map((d, i) => <DuelRow key={i} d={d} mode={mode} />)
                    ) : (
                      <div className="dr-empty">No open duels</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="dr-bottom">
        <div className="dr-tools">
          <div className="dr-mini card">
            <div className="dr-mini-h">Mode</div>
            <div className="dr-mode">
              <button className={"dr-radio" + (mode === "duel" ? " on" : "")} onClick={() => setMode("duel")}>
                <span className="dr-dot" />
                <Icon name="duel" size={16} /> Duel
              </button>
              <button className={"dr-radio" + (mode === "watch" ? " on" : "")} onClick={() => setMode("watch")}>
                <span className="dr-dot" />
                <Icon name="watch" size={16} /> Watch
              </button>
            </div>
          </div>

          <div className="dr-mini card">
            <div className="dr-mini-h">Deck</div>
            {myDecks.length > 0 ? (
              <div className="dr-select">
                <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  {myDecks.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <span className="dr-select-caret"><Icon name="caret" size={16} /></span>
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "var(--muted, #6b7a94)" }}>No decks — build one first</span>
            )}
            <button className="dr-ghost-sm" onClick={() => setShowLogResult(true)}>
              <Icon name="duel" size={14} /> Log Result
            </button>
          </div>
        </div>

        <div className="dr-filter card">
          <div className="dr-card-h">
            <Icon name="search" size={16} stroke="#9cc4ec" />
            <span>Filter / Sort</span>
          </div>
          <div className="dr-field">
            <label>Username</label>
            <input className="dr-input" value={fUser} onChange={(e) => setFUser(e.target.value)} placeholder="Search host…" />
          </div>
          <div className="dr-field">
            <label>Search Card</label>
            <input className="dr-input" value={fCard} onChange={(e) => setFCard(e.target.value)} placeholder="Card name…" />
          </div>
          <div className="dr-field">
            <label>Match Type</label>
            <Select value={fMatch} onChange={setFMatch} options={["Any", "BO1", "BO3"]} />
          </div>
          <div className="dr-field">
            <label>Sort By</label>
            <Select value={fSort} onChange={setFSort} options={["Rating", "Watchers", "Name"]} />
          </div>
        </div>

        <div className="dr-host card">
          <div className="dr-card-h">
            <Icon name="host" size={16} stroke="#ff8079" />
            <span>Host a Duel</span>
          </div>
          <div className="dr-host-form">
            <div className="dr-hcell">
              <label>Format</label>
              <Select value={hFormat} onChange={setHFormat} options={["Standard · OP16", "Standard · OP15", "East Blue"]} />
            </div>
            <div className="dr-hcell">
              <label>Type</label>
              <Select value={hType} onChange={setHType} options={["Best of 3", "Best of 1", "Best of 5"]} />
            </div>
            <div className="dr-hcell">
              <label>Duel Note</label>
              <input className="dr-input" value={hNote} onChange={(e) => setHNote(e.target.value)} placeholder="Visible to duelists" />
            </div>
            <div className="dr-hcell">
              <label>Duel Password</label>
              <input className="dr-input" type="password" value={hPass} onChange={(e) => setHPass(e.target.value)} placeholder="Optional" />
            </div>
            <div className="dr-hcell">
              <label>Watching</label>
              <button className={"dr-check" + (watching ? " on" : "")} onClick={() => setWatching((v) => !v)}>
                <span className="dr-box" /> {watching ? "Allowed" : "Off"}
              </button>
            </div>
            <div className="dr-hcell">
              <label>Watch Note</label>
              <input className="dr-input" disabled={!watching} value={wNote} onChange={(e) => setWNote(e.target.value)} placeholder={watching ? "Visible to spectators" : "Watching off"} />
            </div>
            <div className="dr-hcell">
              <label>Watch Password</label>
              <input className="dr-input" type="password" disabled={!watching} value={wPass} onChange={(e) => setWPass(e.target.value)} placeholder={watching ? "Optional" : "—"} />
            </div>
            <button className="dr-host-btn">
              <Icon name="host" size={16} stroke="#fff" /> Host Duel
            </button>
          </div>
        </div>
      </section>

      <footer className="dr-foot">
        <div className="dr-foot-icons">
          <button className="dr-foot-ico" title="Messages" onClick={() => setView("messages")}>
            <Icon name="chat" size={18} />
            <span className="dr-foot-badge">3</span>
          </button>
          <button className="dr-foot-ico" title="Friends online" onClick={() => setView("friends")}>
            <Icon name="friends" size={18} />
          </button>
        </div>
        <button className="dr-exit" onClick={() => setView("home")}>
          <Icon name="exit" size={15} /> Exit
        </button>
        <span className="dr-credit">
          Background: <a href="https://opengameart.org/node/158492" target="_blank" rel="noopener noreferrer">“Sunset Clouds Over The Sea”</a> by{" "}
          <a href="https://craftpix.net" target="_blank" rel="noopener noreferrer">CraftPix.net</a>,{" "}
          <a href="https://opengameart.org/content/oga-by-30-faq" target="_blank" rel="noopener noreferrer">OGA-BY 3.0</a>
        </span>
        <button className="dr-foot-ico mute" title="Sound">
          <Icon name="sound" size={18} />
        </button>
      </footer>

      {showLogResult && myDecks.length > 0 && (
        <LogResultModal decks={myDecks} cards={cards} onClose={() => setShowLogResult(false)} />
      )}
    </div>
  );
}
