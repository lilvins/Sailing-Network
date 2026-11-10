import { useEffect, useRef, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { api, type Deck, type QueueStatus } from "../../lib/api";
import { loadCardsById, type Card } from "../cards/cardsDb";
import "../home/home.css"; // shared .sn atoms (logo, pill, avatar, livedot, vars)
import "../profiles/profiles.css";
import { Dock } from "../profiles/ProfilePages";
import { useAutoStore } from "../board-auto/autoStore";
import { userDeckChoices, type DeckChoice } from "../board-auto/decks";
import { presetDeckChoices } from "../board-auto/presetDecks";
import { hostDuel, joinDuel, leaveRoom, listOpenDuels, type OpenDuel } from "../board-auto/room";
import { rememberDuelDeck, rememberedDuelDeck } from "./duelDeck";
import "@fontsource/silkscreen/400.css"; // pixel HUD labels (--hud in duelroom.css)
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css"; // pixel duelist names (--pixel)
import "./duelroom.css";
import { PixelIcon, type PixelIconName } from "../pixel/PixelIcon";
import { PixelLogoMark } from "../pixel/PixelLogo";

/* Ported from Claude design (duelroom.jsx). Fluid + responsive; links wired to
   the uiStore router. */

/* icons: the site's pixel set (features/pixel/icons.ts); names here → pixel names */
const DR_ICONS = {
  duel: "swords", watch: "watch", search: "search", lock: "lock", host: "plus", back: "back",
  chat: "chat", friends: "friends", sound: "sound", caret: "caret", exit: "exit",
} as const satisfies Record<string, PixelIconName>;

type IconName = keyof typeof DR_ICONS;

function Icon({ name, size = 22, stroke }: { name: IconName; size?: number; stroke?: string; sw?: number }) {
  return <PixelIcon name={DR_ICONS[name]} size={size} color={stroke === "currentColor" ? undefined : stroke} />;
}

function Logo() {
  return (
    <div className="sn-logo">
      <PixelLogoMark size={38} />
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
      <PixelIcon name="profile" size={size * 0.5} color="rgba(255,255,255,0.55)" />
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
        <PixelIcon name={result === "win" ? "trophy" : "skull"} size={36} color={result === "win" ? "var(--px-gold)" : "var(--px-text-muted)"} />
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

/** The columns of Open Duels; each lists the live duels hosted in that format. */
const FORMATS = [
  { key: "op17", name: "Standard · OP17", accent: "#4f8fd0" },
  { key: "op16", name: "Standard · OP16", accent: "#3f9d7e" },
  { key: "op15", name: "Standard · OP15", accent: "#c98a52" },
  { key: "eastblue", name: "East Blue", accent: "#9a6ad0" },
];
const OPEN_DUELS_POLL_MS = 3000;

function DuelRow({ d, leaderName, disabled, onJoin }: { d: OpenDuel; leaderName: string; disabled: boolean; onJoin: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <div className="dr-duel" data-duel={d.host}>
      <Avatar color="#2f5e44" size={36} />
      <div className="dr-duel-main">
        <div className="dr-duel-top">
          <span className="dr-duel-host">{d.host}</span>
          {d.locked && (
            <span className="dr-duel-lock" title="This duel needs a password">
              <Icon name="lock" size={12} />
            </span>
          )}
        </div>
        <div className="dr-duel-meta">
          <span>{d.type}</span>
          <span className="dot">·</span>
          <span>{leaderName}</span>
          {d.note && (
            <>
              <span className="dot">·</span>
              <span className="dr-duel-note" title={d.note}>“{d.note}”</span>
            </>
          )}
        </div>
      </div>
      {d.locked && !d.mine && (
        <input className="dr-input dr-joinpass" type="text" autoComplete="off" value={password} placeholder="Password" aria-label="Duel password" onChange={(e) => setPassword(e.target.value)} />
      )}
      {d.mine ? (
        <span className="dr-duel-mine">Your duel</span>
      ) : (
        <button className="dr-join" data-act="duel-join" disabled={disabled || (d.locked && !password)} onClick={() => onJoin(password)}>
          Join
        </button>
      )}
    </div>
  );
}

/** The Duelist Pool (ranked) stays closed until two players can share a ranked game:
 *  today a match would open a table with no opponent (docs/release-checklist.md). */
const RANKED_OPEN = false;

export function DuelRoomPage() {
  const setView = useUiStore((s) => s.setView);
  const goBack = useUiStore((s) => s.goBack);
  const online = useAutoStore((s) => s.online);
  const game = useAutoStore((s) => s.game);
  const inGame = online?.status === "playing" && !!game && game.phase !== "over";
  const waiting = online?.status === "waiting";
  const [duels, setDuels] = useState<OpenDuel[]>([]);
  const [busy, setBusy] = useState(false);
  const [duelError, setDuelError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void listOpenDuels().then((list) => { if (alive) setDuels(list); }).catch(() => {});
    load();
    const id = window.setInterval(load, OPEN_DUELS_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [online?.status]);

  // real decks
  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [deckId, setDeckId] = useState("");
  const [showLogResult, setShowLogResult] = useState(false);
  // a real number in the header (registered captains), never an invented "online" count
  const [captains, setCaptains] = useState<number | null>(null);
  useEffect(() => {
    api.siteStats().then((s) => setCaptains(s.captains)).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api.myDecks(), loadCardsById()])
      .then(([{ decks }, cardMap]) => {
        setMyDecks(decks);
        setCards(cardMap);
        const remembered = rememberedDuelDeck();
        const known = remembered && (decks.some((d) => d.id === remembered) || presetDeckChoices().some((d) => d.key === remembered));
        setDeckId(known ? remembered : decks.length ? decks[0].id : presetDeckChoices()[0].key);
      })
      .catch(() => {});
  }, []);

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
      if (!myDecks.some((d) => d.id === deckId)) {
        setDuelError("The Duelist Pool needs one of your own decks.");
        return;
      }
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
  const [fSort, setFSort] = useState("Newest");

  const [hFormat, setHFormat] = useState(FORMATS[0].name);
  const [hType, setHType] = useState("Best of 1");
  const [hNote, setHNote] = useState("");
  const [hPass, setHPass] = useState("");
  // an invitation: the code of a duel, from the box or from a link (?duel=CODE)
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get("duel")?.toUpperCase() ?? "");
  const [joinPass, setJoinPass] = useState("");
  const [copied, setCopied] = useState(false);
  const pickDeck = (id: string) => { setDeckId(id); rememberDuelDeck(id); };
  const copyInvite = () => {
    if (!online) return;
    const link = `${window.location.origin}/?duel=${online.code}`;
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
    void navigator.clipboard?.writeText(link).then(done, done);
  };
  const joinByCode = () => void withDeck(async (deck) => {
    const failed = await joinDuel(joinCode.trim(), deck, joinPass);
    if (!failed) window.history.replaceState(null, "", window.location.pathname); // the invitation is used
    return failed;
  });
  const deckSelect = (
    <div className="dr-select">
      <select value={deckId} data-deck-select aria-label="Your deck" onChange={(e) => pickDeck(e.target.value)}>
        {myDecks.length > 0 && (
          <optgroup label="My decks">
            {myDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </optgroup>
        )}
        <optgroup label="Ready-made">
          {presetDeckChoices().map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
        </optgroup>
      </select>
      <span className="dr-select-caret"><Icon name="caret" size={16} /></span>
    </div>
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const scrollFmt = (dir: number) => {
    if (trackRef.current) trackRef.current.scrollBy({ left: dir * 330, behavior: "smooth" });
  };

  const filterDuels = (format: string) => {
    let r = duels.filter((d) => d.format === format && d.host.toLowerCase().includes(fUser.toLowerCase()));
    if (fMatch !== "Any") r = r.filter((d) => d.type === fMatch);
    return fSort === "Name" ? [...r].sort((a, b) => a.host.localeCompare(b.host)) : [...r].reverse();
  };

  /** The deck picked in the Deck box: one of the ready-made lists or one of yours. */
  const chosenDeck = (): DeckChoice | undefined => {
    const all = [...presetDeckChoices(), ...userDeckChoices(myDecks)];
    return all.find((d) => d.key === deckId || d.key === `mine:${deckId}`);
  };
  const withDeck = async (action: (deck: DeckChoice) => Promise<string | null>) => {
    const deck = chosenDeck();
    if (!deck) { setDuelError("Pick a deck in the Deck box first."); return; }
    setBusy(true);
    setDuelError(null);
    const failed = await action(deck).catch((e: unknown) => (e instanceof Error ? e.message : "The server did not answer"));
    setBusy(false);
    if (failed) setDuelError(failed);
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
          <button className="dr-back" title="Back" data-act="back" onClick={goBack}>
            <Icon name="back" size={18} />
          </button>
          <Logo />
        </div>
        <h1 className="dr-title">Duel Room</h1>
        <div className="dr-head-r">
          <div className="sn-pill">
            <span className="sn-livedot" /> {captains === null ? "…" : captains.toLocaleString("en-US")} captains aboard
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
          {!RANKED_OPEN && (
            <p className="dr-pool-desc" data-pool-closed>
              Ranked is not open yet: two players cannot share a ranked game. To play a friend,
              use <b>Host a Duel</b> below or <b>Join with a code</b>.
            </p>
          )}
          {RANKED_OPEN && (<>
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
          </>)}
        </div>

        <div className="dr-open">
          <div className="dr-open-head">
            <span className="dr-open-title">Open Duels</span>
            <label className="dr-open-deck">You play with {deckSelect}</label>
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
              const list = filterDuels(f.name);
              return (
                <div className="dr-fmt card" key={f.key}>
                  <div className="dr-fmt-h" style={{ borderColor: f.accent }}>
                    <span className="dr-fmt-dot" style={{ background: f.accent }} />
                    <span className="dr-fmt-name">{f.name}</span>
                    <span className="dr-fmt-count">{list.length}</span>
                  </div>
                  <div className="dr-fmt-list">
                    {list.length ? (
                      list.map((d) => (
                        <DuelRow
                          key={d.id}
                          d={d}
                          leaderName={cards?.get(d.leaderId)?.name ?? d.leaderId}
                          disabled={busy || waiting || inGame}
                          onJoin={(password) => void withDeck((deck) => joinDuel(d.id, deck, password, d.format))}
                        />
                      ))
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
            <div className="dr-mini-h">Join with a code</div>
            <input className="dr-input" data-join-code autoComplete="off" spellCheck={false} maxLength={6} value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Code from your friend" aria-label="Duel code" />
            <input className="dr-input" type="text" autoComplete="off" value={joinPass} onChange={(e) => setJoinPass(e.target.value)} placeholder="Password, if any" aria-label="Password of that duel" />
            <button className="dr-ghost-sm" data-act="join-code" disabled={busy || waiting || inGame || joinCode.trim().length !== 6} onClick={joinByCode}>
              <Icon name="duel" size={14} /> Join
            </button>
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
            <Select value={fSort} onChange={setFSort} options={["Newest", "Name"]} />
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
              <Select value={hFormat} onChange={setHFormat} options={FORMATS.map((f) => f.name)} />
            </div>
            <div className="dr-hcell">
              <label>Your deck</label>
              {deckSelect}
            </div>
            <div className="dr-hcell">
              <label>Type</label>
              <Select value={hType} onChange={setHType} options={["Best of 1"]} />
            </div>
            <div className="dr-hcell">
              <label>Duel Note</label>
              <input className="dr-input" autoComplete="off" value={hNote} onChange={(e) => setHNote(e.target.value)} placeholder="Visible to duelists" />
            </div>
            <div className="dr-hcell">
              <label>Duel Password</label>
              <input className="dr-input" type="text" autoComplete="off" data-duel-password value={hPass} onChange={(e) => setHPass(e.target.value)} placeholder="Optional" />
            </div>
            {duelError && <p className="dr-host-msg" role="alert">{duelError}</p>}
            {waiting && (
              <div className="dr-pool-status dr-host-wait">
                <span className="dr-spinner" /> Waiting for a duelist. The duel starts when someone joins.
                {online && (
                  <span className="dr-invite">
                    Code <b data-duel-code>{online.code}</b>
                    <button className="dr-ghost-sm" data-act="copy-invite" onClick={copyInvite}>{copied ? "Link copied" : "Copy invite link"}</button>
                  </span>
                )}
              </div>
            )}
            {waiting ? (
              <button className="dr-host-btn" data-act="duel-cancel" onClick={() => { leaveRoom(); setHPass(""); }}>
                Cancel
              </button>
            ) : (
              <button
                className="dr-host-btn"
                data-act="duel-host"
                disabled={busy}
                onClick={() => void withDeck((deck) => hostDuel(deck, { format: hFormat, type: hType.replace("Best of ", "BO"), note: hNote, password: hPass }))}
              >
                <Icon name="host" size={16} stroke="#fff" /> Host Duel
              </button>
            )}
          </div>
        </div>
      </section>

      <footer className="dr-foot">
        <span className="dr-credit">
          Background: <a href="https://opengameart.org/node/158492" target="_blank" rel="noopener noreferrer">“Sunset Clouds Over The Sea”</a> by{" "}
          <a href="https://craftpix.net" target="_blank" rel="noopener noreferrer">CraftPix.net</a>,{" "}
          <a href="https://opengameart.org/content/oga-by-30-faq" target="_blank" rel="noopener noreferrer">OGA-BY 3.0</a>
          {" · "}
          <button className="dr-credit-all" onClick={() => setView("credits")}>All credits</button>
        </span>
        <button className="dr-foot-ico mute" title="Sound">
          <Icon name="sound" size={18} />
        </button>
      </footer>
      <Dock />

      {showLogResult && myDecks.length > 0 && (
        <LogResultModal decks={myDecks} cards={cards} onClose={() => setShowLogResult(false)} />
      )}
    </div>
  );
}
