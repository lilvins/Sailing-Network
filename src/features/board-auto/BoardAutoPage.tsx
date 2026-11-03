import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CardArt, DonArt } from "../board/BoardPage";
import { cardColorHex, type Card } from "../cards/cardsDb";
import { api, type DirectoryUser } from "../../lib/api";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import { legalMoves } from "../../autosim/engine/legality";
import { fitChoice } from "../../autosim/engine/effects";
import { effectivePower, keywordsOf, type AutoGameState, type Iid, type PID } from "../../autosim/engine/state";
import type { Keyword } from "../../autosim/ir/types";
import type { PlayerIntent } from "../../autosim/engine/intents";
import { getCardDb, getCardsById, isAiSeat, useAutoStore, type SeatSetup } from "./autoStore";
import { automationInfo } from "./compile";
import { restSplitOf } from "./restSplit";
import { buildDemoDecks, metaDeckChoices, userDeckChoices, type DeckChoice, type MetaDeckFile } from "./decks";
import { fmtEvent } from "./log";
import { NightSea } from "../home/NightSea";
import "../home/home.css"; // .nsea layers (shared with the Home hero)
import "@fontsource/vt323/400.css"; // pixel type for the log + chat (--pixel in boardauto.css)
import "@fontsource/silkscreen/400.css"; // HUD labels (--hud)
import "@fontsource/silkscreen/700.css";
import "./boardauto.css";
import { PixelIcon } from "../pixel/PixelIcon";

/* =============================================================================
   BOARD AUTO — the AUTOSIM full-rules board (AUTOSIM_PLAN.md §7).
   Presentation only: every move is a PlayerIntent through autoStore.dispatch;
   affordances come exclusively from legality.ts / the pending ChoiceRequest.
   Hotseat: seat A plays the bottom half, seat B the top one (NOT rotated —
   both players sit on the same side of one screen, readability wins).
   ========================================================================== */

const SEAT_A: PID = "seatA";
const SEAT_B: PID = "seatB";

type Controller = "human" | "ai";
const AI_NAMES: [string, string] = ["Bot Pro", "Bot Pro 2"];
/** Pause between two AI moves. */
const AI_SPEEDS = [{ label: "Slow", ms: 1400 }, { label: "Normal", ms: 700 }, { label: "Fast", ms: 150 }];

const KW_LABEL: Record<Keyword, string> = {
  Rush: "RUSH",
  DoubleAttack: "2×ATK",
  Banish: "BANISH",
  Blocker: "BLOCK",
  RushCharacter: "RUSH:C",
  Unblockable: "UNBLOCK",
};

const WIN_REASON: Record<string, string> = {
  leaderDamageAtZeroLife: "lethal damage to the Leader",
  deckOut: "the opponent decked out",
  concession: "concession",
  effect: "a card's effect",
  deckOutWin: "their deck ran out — and their Leader wins on deck-out",
};

// ─── dev hook for the Playwright verification driver ─────────────────────────
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__auto = {
    state: () => {
      const s = useAutoStore.getState();
      const db = getCardDb();
      return {
        stage: s.stage,
        game: s.game,
        legal: s.game && db ? legalMoves(db, s.game) : null,
      };
    },
    events: () => useAutoStore.getState().events,
    /** Drivers: card category by id (so synthetic tables only seat Characters). */
    cardCategory: (cardId: string) => { try { return getCardDb()?.(cardId)?.category ?? null; } catch { return null; } },
    /** QA bot: subscribe to the store (e.g. to trace what raised a banner). */
    store: useAutoStore,
    /** QA crawler: jump to any app view (uiStore) without clicking through. */
    setView: (v: string) => useUiStore.getState().setView(v as Parameters<ReturnType<typeof useUiStore.getState>["setView"]>[0]),
  };
}

// ─── viewport mode ────────────────────────────────────────────────────────────

/** The table is a FIXED-RESOLUTION STAGE (like OPTCGSim / Master Duel): one
 *  desktop layout drawn at STAGE_W×STAGE_H virtual px, then scaled to fit the
 *  viewport (letterboxed) and rotated 90° when the viewport is portrait.
 *  No media queries, no vw/vh inside the stage — by design, not responsive. */
/** The stage is always 1080 tall; its WIDTH follows the viewport's aspect
 *  (1728…2400, i.e. 16:10 … 20:9) so a 16:10 laptop or a 20:9 phone gets no
 *  letterbox: the height is what bounds the card size, the extra width goes
 *  to the rails (bigger inspector, wider log). */
const STAGE_H = 1080;
const STAGE_W_MIN = 1728;
const STAGE_W_MAX = 2400;
/** Stage padding + grid gaps, the field column's max width, the rails' floor. */
const STAGE_CHROME = 32;
const FIELD_MAX = 1400;
const RAIL_MIN = 280;
/** Table card size (stage px) — mirrors --bacw / --bach in boardauto.css.
 *  The height budget: 4 table rows + band + both hands = 1080
 *  (user 2026-10-27: "tutte le carte sono ancora troppo piccole"). */
const CARD_W = 116;
const CARD_H = CARD_W * 1.4;
/** The top hand (the other seat's, a back row online) stays compact. */
const TOP_HAND_W = 88;
/** DON!! cards (cost area + DON!! deck pile) — all identical, so smaller. */
const DON_W = 80;
const DON_H = DON_W * 1.4;
/** Life pile: vertical cascade step (stage px) — a strip per card. */
const LIFE_STEP = 10;
/** Cost-area cascade step: each DON!! is uncovered for 28px (35% of a card,
 *  25% of a rotated card's footprint — the bot requires ≥25%). */
const DON_STEP = 28;
/** What a DON!!-moving effect asks for, answered by clicks on the table. */
interface DonChoice {
  from: "active" | "rested" | "deck";
  verb: string;
  max: number;
  min: number;
  sourceIid: Iid;
  answer: (n: number) => PlayerIntent;
}
/** The "give up to N rested DON!!" options (compiler/textIr.ts, giveUpToRested). */
const GIVE_DON_OPTION = /^Give (no DON!!|\d+ rested DON!!)$/;

/** An AI answer inside a battle never comes faster than this (ms), and the
 *  outcome of a battle stays on screen this long before play goes on. */
const BATTLE_BEAT = 900;
const RECAP_MS = 1600;
/** How far a split DON!! group rises per level (visual thinking aid). */
const DON_RAISE = 26;
/** DON!! drawn under a card they are given to (the badge still says the exact number). */
const MAX_DON_PEEKS = 4;

interface StageFit { scale: number; rotate: boolean; ox: number; oy: number; w: number; rail: number; field: number }

function fitStage(vw: number, vh: number): StageFit {
  const rotate = vh > vw; // portrait → the stage lies on its side
  const long = rotate ? vh : vw;
  const short = rotate ? vw : vh;
  const sw = Math.round(Math.min(STAGE_W_MAX, Math.max(STAGE_W_MIN, (STAGE_H * long) / short)));
  const rail = Math.max(RAIL_MIN, Math.floor((sw - STAGE_CHROME - FIELD_MAX) / 2));
  const field = sw - STAGE_CHROME - 2 * rail;
  const w = rotate ? STAGE_H : sw; // device-space footprint
  const h = rotate ? sw : STAGE_H;
  const scale = Math.min(vw / w, vh / h);
  return { scale, rotate, ox: (vw - w * scale) / 2, oy: (vh - h * scale) / 2, w: sw, rail, field };
}

/** How many cards of width cw fit side by side in a hand row (6px gaps,
 *  2×6 padding) before the hand turns into a declared ordered stack. */
function handInner(field: number): number { return field - 12; }
function handCapacity(field: number, cw: number): number { return Math.floor((handInner(field) + 6) / (cw + 6)); }

function useStageFit(): StageFit {
  const [fit, setFit] = useState<StageFit>(() =>
    typeof window !== "undefined" ? fitStage(window.innerWidth, window.innerHeight) : fitStage(1920, 1080));
  useEffect(() => {
    const on = () => setFit(fitStage(window.innerWidth, window.innerHeight));
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return fit;
}

/** CSS transform for the stage box (origin 0 0). Portrait: rotate 90° CW
 *  about the top-left corner after lifting the box by its own height, so the
 *  rotated box occupies [0,STAGE_H]×[0,STAGE_W]; then scale and center. */
function stageTransform(f: StageFit): string {
  return f.rotate
    ? `translate(${f.ox}px, ${f.oy}px) scale(${f.scale}) rotate(90deg) translateY(-${STAGE_H}px)`
    : `translate(${f.ox}px, ${f.oy}px) scale(${f.scale})`;
}

/** Phone landscape, level 1 (needs a user gesture): fullscreen + orientation
 *  lock where the platform allows it (Android Chrome). Silent otherwise —
 *  iOS Safari has no lock; level 2 (CSS rotation, `.ba-forced`) always works. */
function tryEnterLandscape(): void {
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
  try {
    const p = document.documentElement.requestFullscreen?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch { /* unsupported */ }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (t: string) => Promise<void> };
    const p = o.lock?.("landscape");
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch { /* unsupported */ }
}
function leaveLandscape(): void {
  if (typeof document === "undefined") return;
  try {
    (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
  } catch { /* unsupported */ }
  try {
    if (document.fullscreenElement) {
      const p = document.exitFullscreen?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch { /* unsupported */ }
}

// ─── page root ────────────────────────────────────────────────────────────────

export function BoardAutoPage() {
  const stage = useAutoStore((s) => s.stage);
  const catalogReady = useAutoStore((s) => s.catalogReady);
  const catalogError = useAutoStore((s) => s.catalogError);
  const game = useAutoStore((s) => s.game);
  const init = useAutoStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (catalogError) {
    return (
      <div className="ba-root ba-center-screen">
        <div className="ba-panel ba-note">
          <b>Card catalog unavailable</b>
          <p>{catalogError}</p>
          <p>Is the API running? (npm run dev starts it on :8787)</p>
        </div>
      </div>
    );
  }
  if (!catalogReady) {
    return (
      <div className="ba-root ba-center-screen">
        <span className="ba-loading">Loading the card catalog…</span>
      </div>
    );
  }
  if (stage === "pick") return <PickScreen />;
  if (stage === "roll") return <RollScreen />;
  if (!game) return <PickScreen />;
  return <GameScreen />;
}

// ─── banner (explained refusals, grammar rule #7) ─────────────────────────────

function Banner() {
  const banner = useAutoStore((s) => s.banner);
  const dismiss = useAutoStore((s) => s.dismissBanner);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(dismiss, 4800);
    return () => clearTimeout(t);
  }, [banner, dismiss]);
  if (!banner) return null;
  return (
    <div className={`ba-banner${banner.tone === "info" ? " info" : ""}`} role="alert" onClick={dismiss}>
      <b>{banner.text}</b>
      {banner.hint && <span>{banner.hint}</span>}
    </div>
  );
}

// ─── deck pick ────────────────────────────────────────────────────────────────

function PickScreen() {
  const confirmSeats = useAutoStore((s) => s.confirmSeats);
  const user = useAuthStore((s) => s.user);
  const setView = useUiStore((s) => s.setView);
  const cards = getCardsById()!;

  const demoDecks = useMemo(() => buildDemoDecks(cards), [cards]);
  const [mine, setMine] = useState<DeckChoice[]>([]);
  const [meta, setMeta] = useState<DeckChoice[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/data/meta-decks.json")
      .then((r) => (r.ok ? (r.json() as Promise<MetaDeckFile>) : Promise.reject(new Error(String(r.status)))))
      .then((file) => { if (alive) setMeta(metaDeckChoices(file)); })
      .catch(() => {});
    api
      .myDecks()
      .then((r) => {
        if (alive) setMine(userDeckChoices(r.decks));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const aiOpponent = useAutoStore((s) => s.aiOpponent);
  const [names, setNames] = useState<[string, string]>([user?.username ?? "Player 1", aiOpponent ? AI_NAMES[1] : "Player 2"]);
  const [sel, setSel] = useState<[DeckChoice | null, DeckChoice | null]>([null, null]);
  const [ctrl, setCtrl] = useState<[Controller, Controller]>(["human", aiOpponent ? "ai" : "human"]);
  const options = [...meta, ...demoDecks, ...mine];

  const setController = (idx: 0 | 1, c: Controller) => {
    const nextCtrl: [Controller, Controller] = [...ctrl];
    nextCtrl[idx] = c;
    setCtrl(nextCtrl);
    // a default name follows the controller; a typed one is kept
    const humanName = idx === 0 ? user?.username ?? "Player 1" : "Player 2";
    if (names[idx] === humanName || names[idx] === AI_NAMES[idx]) {
      const next: [string, string] = [...names];
      next[idx] = c === "ai" ? AI_NAMES[idx] : humanName;
      setNames(next);
    }
  };

  const start = (seatsCtrl: [Controller, Controller], decks: [DeckChoice, DeckChoice], seatNames: [string, string]) => {
    tryEnterLandscape(); // user gesture: the table is landscape-first
    const seats: [SeatSetup, SeatSetup] = [
      { pid: SEAT_A, name: seatNames[0].trim(), deck: decks[0], controller: seatsCtrl[0] },
      { pid: SEAT_B, name: seatNames[1].trim(), deck: decks[1], controller: seatsCtrl[1] },
    ];
    confirmSeats(seats);
  };

  /** Both seats to the AI, any missing deck drawn from the meta lists, straight to the roll. */
  const watchAiVsAi = () => {
    const pool = meta.length >= 2 ? meta : options;
    const draw = (not?: DeckChoice | null) => {
      const rest = pool.filter((d) => d.key !== not?.key);
      return rest[Math.floor(Math.random() * rest.length)];
    };
    const a = sel[0] ?? draw(sel[1]);
    const b = sel[1] ?? draw(a);
    start(["ai", "ai"], [a, b], [AI_NAMES[0], AI_NAMES[1]]);
  };

  const seatCol = (idx: 0 | 1) => (
    <div className="ba-seatcol">
      <div className="ba-seathead">
        <span className="ba-seattag">{idx === 0 ? "SEAT A — bottom" : "SEAT B — top"}</span>
        <span className="ba-ctrl" role="group" aria-label="Who plays this seat">
          {(["human", "ai"] as const).map((c) => (
            <button
              key={c}
              className={`ba-ctrlopt${ctrl[idx] === c ? " on" : ""}`}
              data-act={`ctrl-${c}`}
              data-seat={idx}
              onClick={() => setController(idx, c)}
            >
              {c === "human" ? "Human" : "AI"}
            </button>
          ))}
        </span>
        <input
          className="ba-nameinput"
          value={names[idx]}
          maxLength={18}
          onChange={(e) => {
            const next: [string, string] = [...names];
            next[idx] = e.target.value;
            setNames(next);
          }}
        />
      </div>
      <div className="ba-decklist">
        {options.map((d) => {
          const leader = cards.get(d.leaderId);
          const active = sel[idx]?.key === d.key;
          return (
            <button
              key={d.key}
              className={`ba-deckopt${active ? " on" : ""}`}
              data-deck-key={d.key}
              data-seat={idx}
              onClick={() => {
                const next: [DeckChoice | null, DeckChoice | null] = [...sel];
                next[idx] = d;
                setSel(next);
              }}
            >
              <span className="ba-deckthumb" style={{ background: leader ? cardColorHex(leader) : "#3a4a5e" }}>
                {leader?.image && <img src={leader.image} alt="" loading="lazy" />}
              </span>
              <span className="ba-deckmeta">
                <b>{d.name}</b>
                <i>{d.sub}</i>
                {d.warn && <i className="ba-deckwarn">{d.warn}</i>}
              </span>
            </button>
          );
        })}
        {options.length === 0 && <p className="ba-note">No decks available.</p>}
      </div>
    </div>
  );

  const ready = sel[0] && sel[1] && names[0].trim() && names[1].trim();
  return (
    <div className="ba-root ba-setup">
      {/* ansimuz "Ocean View" night layers (CC0): sky, drifting clouds, waves */}
      <div className="ba-ocean" aria-hidden="true"><i className="back" /><i className="clouds" /><i className="waves" /></div>
      <Banner />
      <header className="ba-setuphead">
        <button className="ba-btn" data-act="home" onClick={() => setView("home")}>← Home</button>
        <h1>PLAY AUTO — FULL RULES</h1>
        <span className="ba-sub">Hotseat or against the AI · every rule enforced by the AUTOSIM engine</span>
      </header>
      <div className="ba-pickgrid">
        {seatCol(0)}
        {seatCol(1)}
      </div>
      <footer className="ba-setupfoot">
        <button
          className="ba-btn big"
          data-act="watch-ai"
          disabled={options.length < 2}
          title="Two AI players, the decks you picked (or two random meta decks)"
          onClick={watchAiVsAi}
        >
          Watch AI vs AI
        </button>
        <button
          className="ba-btn primary big"
          data-act="start"
          disabled={!ready}
          onClick={() => {
            if (ready) start(ctrl, [sel[0]!, sel[1]!], names);
          }}
        >
          To the starting roll →
        </button>
        <span className="ba-credit pick">
          Background: <a href="https://opengameart.org/node/133444" target="_blank" rel="noopener noreferrer">“Ocean View”</a> by Luis Zuno (CC0)
        </span>
      </footer>
    </div>
  );
}

// ─── starting roll ────────────────────────────────────────────────────────────

function RollScreen() {
  const seats = useAutoStore((s) => s.seats)!;
  const roll = useAutoStore((s) => s.roll);
  const doRoll = useAutoStore((s) => s.doRoll);
  const chooseFirst = useAutoStore((s) => s.chooseFirst);
  const reset = useAutoStore((s) => s.reset);

  const winner = roll ? seats[roll.winnerIdx] : null;
  const allAi = seats.every((s) => s.controller === "ai");
  // AI vs AI rolls by itself; an AI that wins the roll goes first
  useEffect(() => {
    if (!roll && allAi) {
      const t = setTimeout(doRoll, 700);
      return () => clearTimeout(t);
    }
    if (roll && seats[roll.winnerIdx].controller === "ai") {
      const t = setTimeout(() => chooseFirst(roll.winnerIdx), 1100);
      return () => clearTimeout(t);
    }
  }, [roll, allAi, seats, doRoll, chooseFirst]);
  return (
    <div className="ba-root ba-center-screen">
      <Banner />
      <div className="ba-panel ba-roll">
        <h2>STARTING ROLL</h2>
        <div className="ba-rollrow">
          <div className="ba-rollseat">
            <b>{seats[0].name}</b>
            <span className="ba-die" data-testid="die-a">{roll ? roll.a : "–"}</span>
          </div>
          <span className="ba-vs">VS</span>
          <div className="ba-rollseat">
            <b>{seats[1].name}</b>
            <span className="ba-die" data-testid="die-b">{roll ? roll.b : "–"}</span>
          </div>
        </div>
        {!roll ? (
          <button className="ba-btn primary big" data-act="roll" onClick={() => { tryEnterLandscape(); doRoll(); }}>Roll</button>
        ) : (
          <>
            <p className="ba-rollwin">
              <b>{winner!.name}</b> wins the roll and chooses:
            </p>
            <div className="ba-rollchoices">
              <button className="ba-btn primary" data-act="first" onClick={() => { tryEnterLandscape(); chooseFirst(roll.winnerIdx); }}>
                Play first <i>(no draw, 1 DON!!)</i>
              </button>
              <button className="ba-btn" data-act="second" onClick={() => { tryEnterLandscape(); chooseFirst(roll.winnerIdx === 0 ? 1 : 0); }}>
                Play second <i>(draw + 2 DON!!)</i>
              </button>
            </div>
          </>
        )}
        <button className="ba-btn ghost" data-act="backpick" onClick={reset}>← Change decks</button>
      </div>
    </div>
  );
}

// ─── game screen ─────────────────────────────────────────────────────────────

type Mode =
  | { t: "idle" }
  | { t: "don"; picked: number[] } // 1-based indexes of the selected active DON!! (UI only: DON are fungible)
  | { t: "attack"; iid: Iid; targets: Iid[] }
  /** one of your cards selected in the Main Phase (no attack possible): its actions in the bar */
  | { t: "card"; iid: Iid }
  | { t: "replace"; handIid: Iid };

interface Arrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

function findCardId(game: AutoGameState, iid: Iid): string | null {
  for (const p of Object.values(game.players)) {
    const inst = p.instances[iid];
    if (inst) return inst.cardId;
  }
  return null;
}

function GameScreen() {
  const game = useAutoStore((s) => s.game)!;
  const events = useAutoStore((s) => s.events);
  const seats = useAutoStore((s) => s.seats)!;
  const dispatch = useAutoStore((s) => s.dispatch);
  const explain = useAutoStore((s) => s.explain);
  const rematch = useAutoStore((s) => s.rematch);
  const reset = useAutoStore((s) => s.reset);
  const setView = useUiStore((s) => s.setView);

  const db = getCardDb()!;
  // M5: "total cost / power of N or less", "different names" — the picks must fit
  const setOk = (pc: Extract<NonNullable<AutoGameState["pendingChoice"]>, { kind: "selectTargets" }>, iids: string[]) =>
    fitChoice(db, game, pc, iids).length === iids.length;
  const cards = getCardsById()!;
  const lm = useMemo(() => legalMoves(db, game), [db, game]);
  const pc = game.pendingChoice;

  /** Effects that move DON!! (set active, rest, add from the DON!! deck, give
   *  rested ones): answered by clicking the DON!! on the table — the clicks
   *  are counted and sent as the number / option the engine asks for. */
  const donChoice = ((): DonChoice | null => {
    if (!pc || isAiSeat(seats, pc.player)) return null;
    const player = pc.player;
    if (pc.kind === "chooseNumber" && (pc.purpose === "standDon" || pc.purpose === "restDon" || pc.purpose === "addDon")) {
      const from = pc.purpose === "standDon" ? "rested" : pc.purpose === "restDon" ? "active" : "deck";
      const verb = pc.purpose === "standDon" ? "set as active" : pc.purpose === "restDon" ? "rest" : "add";
      return { from, verb, max: pc.max, min: pc.min, sourceIid: pc.sourceIid, answer: (n) => ({ type: "respondNumber", player, value: n }) };
    }
    if (pc.kind === "chooseOption" && pc.options.length > 1 && pc.options.every((o) => GIVE_DON_OPTION.test(o))) {
      const counts = pc.options.map((o) => Number(/\d+/.exec(o)?.[0] ?? 0));
      const max = Math.min(Math.max(...counts), game.players[player].don.rested);
      return { from: "rested", verb: "give", max, min: 0, sourceIid: pc.sourceIid, answer: (n) => ({ type: "respondOption", player, index: counts.indexOf(n) }) };
    }
    return null;
  })();

  /** "Rest 1 of your cards:" and its kin: what gets clicked is what gets rested. */
  const restSplit = pc && !isAiSeat(seats, pc.player) ? restSplitOf(getCardDb()!, game) : null;

  /** How the last battle ended, shown for a beat after it (HIT / REPELLED / K.O.). */
  const [recap, setRecap] = useState<{ text: string; sub: string; tone: "hit" | "miss" } | null>(null);
  // AI seats: one move per tick while it is their move
  const aiStep = useAutoStore((s) => s.aiStep);
  const aiPaused = useAutoStore((s) => s.aiPaused);
  const aiPlan = useAutoStore((s) => s.aiPlan);
  const aiDelay = useAutoStore((s) => s.aiDelay);
  const setAiPaused = useAutoStore((s) => s.setAiPaused);
  const setAiDelay = useAutoStore((s) => s.setAiDelay);
  // fewer confirmations by default (user request); the table switch brings them back
  const confirmPicks = useAutoStore((s) => s.confirmPicks);
  const setConfirmPicks = useAutoStore((s) => s.setConfirmPicks);
  const hasAi = seats.some((s) => s.controller === "ai");
  // take-backs: the last move a person made, and the open request (if any)
  const history = useAutoStore((s) => s.history);
  const undoRequest = useAutoStore((s) => s.undoRequest);
  const requestUndo = useAutoStore((s) => s.requestUndo);
  const answerUndo = useAutoStore((s) => s.answerUndo);
  const lastHumanMove = [...history].reverse().find((h) => !isAiSeat(seats, h.actor)) ?? null;
  const aiActing = game.phase !== "over" && isAiSeat(seats, lm.actor);
  /** Human against AI: the AI's hand stays face down (AI vs AI shows both to the spectator). */
  const hiddenHand = (pid: PID) => game.phase !== "over" && isAiSeat(seats, pid) && !seats.every((s) => s.controller === "ai");
  useEffect(() => {
    if (!aiActing || aiPaused) return;
    // a battle is followed step by step: the AI never answers faster than you can read
    const delay = game.battle ? Math.max(aiDelay, BATTLE_BEAT) : recap ? Math.max(aiDelay, RECAP_MS) : aiDelay;
    const t = setTimeout(aiStep, delay);
    return () => clearTimeout(t);
  }, [game, aiActing, aiPaused, aiDelay, aiStep, recap]);

  const seatName = (pid: PID) => seats.find((s) => s.pid === pid)?.name ?? pid;
  const leaderHex = (pid: PID) => {
    const leaderCard = cards.get(game.players[pid].instances[game.players[pid].leaderIid].cardId);
    return leaderCard ? cardColorHex(leaderCard) : "#3a4a5e";
  };

  // profile pictures (DuelingBook): a seat named like a captain shows that
  // captain's avatar (favourite leader + colour); anyone else shows their
  // deck's Leader art
  const [captains, setCaptains] = useState<DirectoryUser[]>([]);
  useEffect(() => {
    let alive = true;
    api.directory().then(({ users }) => { if (alive) setCaptains(users); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const avatarOf = (pid: PID) => {
    const name = seatName(pid).toLowerCase();
    const u = captains.find((c) => c.username.toLowerCase() === name || c.displayName.toLowerCase() === name);
    const fav = u?.favoriteLeader ? cards.get(u.favoriteLeader)?.image : null;
    const leader = cards.get(game.players[pid].instances[game.players[pid].leaderIid].cardId);
    return { image: fav || leader?.image || null, color: u?.avatarColor || leaderHex(pid) };
  };

  const [preview, setPreview] = useState<Card | null>(null);
  const [mode, setMode] = useState<Mode>({ t: "idle" });
  const [picked, setPicked] = useState<Iid[]>([]);
  const [armConcede, setArmConcede] = useState<PID | null>(null);
  // fixed-resolution stage, scaled (and rotated in portrait) to the viewport
  const stage = useStageFit();
  // while at the table: no page rubber-banding or pull-to-refresh (the viewport
  // reads this from <html>, not <body>); leaving it (home, change decks,
  // rematch) releases the orientation lock
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overscrollBehavior = prev;
      leaveLandscape();
    };
  }, []);
  /** Hand card selected by a tap: shows the in-place PLAY button (if legal);
   *  a second tap deselects. */
  const [selectedHand, setSelectedHand] = useState<Iid | null>(null);
  // table chat (local, hotseat): not game state, never reaches the engine
  // `at` = events.length when sent: the message is interleaved into the duel
  // log feed right after the event that was last at that moment
  const [chat, setChat] = useState<{ seat: PID; text: string; at: number }[]>([]);
  // transient per-card flashes (DON!! attached, attacked, countered, effect
  // activated): a class for ≤450ms, no state in the engine
  const [flash, setFlash] = useState<Record<Iid, string>>({});
  // drag-to-play: a hand card dragged over the owner's half is played there
  const dragRef = useRef<{ iid: Iid; owner: PID; x0: number; y0: number; active: boolean } | null>(null);
  const [drag, setDrag] = useState<{ iid: Iid; owner: PID; cardId: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSeat, setChatSeat] = useState<PID>(SEAT_A);
  // M3 windows: local drafts of the answer being composed
  const [peekTake, setPeekTake] = useState<Iid[]>([]);
  const [peekOrder, setPeekOrder] = useState<Iid[]>([]);
  const [peekSide, setPeekSide] = useState<Record<Iid, "top" | "bottom">>({});
  /** Search, step 2: the cards left are laid out in a row to drag into order. */
  const [peekArranging, setPeekArranging] = useState(false);
  const peekDragRef = useRef<Iid | null>(null);
  // DON!!−X (8-3-1-6): the DON!! clicked on the table to return — cost-area
  // indexes (active / rested) and a count per card with DON!! given to it
  /** DON!! clicked to answer a DON!!-moving effect (cost-area indexes, or one per DON!! deck click) */
  const [donPick, setDonPick] = useState<number[]>([]);
  const [payPick, setPayPick] = useState<{ active: number[]; rested: number[]; given: Record<Iid, number> }>({
    active: [], rested: [], given: {},
  });
  const [numberPick, setNumberPick] = useState<number | null>(null);
  // DON groups: PURELY VISUAL thinking aid. Per seat, the 0-based indexes of
  // the active DON!! where a new group starts (right-click splits there and
  // raises the rest one level). Never an intent — the engine's DON state is
  // untouched (plan §1 rule); a group dragged onto a card gives that many.
  const [donSplits, setDonSplits] = useState<Record<PID, number[]>>({});
  const donDragRef = useRef<{ pid: PID; count: number; groups: number[]; group: number; x0: number; y0: number; active: boolean } | null>(null);
  const [donDrag, setDonDrag] = useState<{ count: number; x: number; y: number } | null>(null);
  const donHintShown = useRef(false);
  const [hoverTarget, setHoverTarget] = useState<Iid | null>(null);
  const nodeMap = useRef(new Map<Iid, HTMLElement>());
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const reg = (iid: Iid) => (el: HTMLElement | null) => {
    if (el) nodeMap.current.set(iid, el);
    else nodeMap.current.delete(iid);
  };

  // any engine answer / new prompt invalidates the local interaction mode
  useEffect(() => {
    setMode({ t: "idle" });
    setPicked([]);
    setHoverTarget(null);
    setPeekTake([]);
    setPeekOrder([]);
    setPeekSide({});
    setPeekArranging(false);
    setPayPick({ active: [], rested: [], given: {} });
    setDonPick([]);
    setNumberPick(null);
  }, [pc, game.turn, game.battle?.step, game.phase]);

  // windows with nothing to decide close by themselves (unless "confirm every
  // choice" is on): no [Blocker] to block with, nothing usable to counter with
  const noCounters = pc?.kind === "counterWindow" && lm.counterCards.length + lm.counterEvents.length === 0;
  const noBlockers = pc?.kind === "blockWindow" && pc.blockers.length === 0;
  useEffect(() => {
    if (confirmPicks || !pc || isAiSeat(seats, pc.player)) return;
    if (noBlockers) dispatch({ type: "respondBlock", player: pc.player, blockerIid: null });
    else if (noCounters) dispatch({ type: "passCounter", player: pc.player });
  }, [pc, noBlockers, noCounters, confirmPicks, seats, dispatch]);

  // keyboard: Esc drops the current selection, E ends the turn (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") { setMode({ t: "idle" }); setSelectedHand(null); }
      else if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey && lm.canEndTurn && !aiActing) {
        dispatch({ type: "endTurn", player: game.turnPlayer });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lm.canEndTurn, aiActing, dispatch, game.turnPlayer]);

  // DON groups reset at every turn change (they are thinking aids)
  useEffect(() => {
    setDonSplits({});
  }, [game.turn]);

  // compact: a selected hand card that left the hand (played / discarded /
  // turn passed) is deselected
  useEffect(() => {
    if (!selectedHand) return;
    const inHand = Object.values(game.players).some((p) => p.zones.hand.includes(selectedHand));
    if (!inHand || game.pendingChoice) setSelectedHand(null);
  }, [game, selectedHand]);

  // touch: long-press on an active DON splits there (no right-click)
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const donPressStart = (pid: PID, index: number, pointerType: string) => {
    if (pointerType !== "touch") return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      donDragRef.current = null;
      splitDonAt(pid, index);
    }, 480);
  };
  const donPressEnd = () => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  /** Right-click on the n-th active DON!!: it and the ones after it (in its
   *  group) rise one level. On the first DON!! of a raised group: it drops
   *  back (merge). On the very first DON!!: every group is merged. */
  const splitDonAt = (pid: PID, index: number) => {
    setDonSplits((prev) => {
      const cur = (prev[pid] ?? []).filter((s) => s < game.players[pid].don.active);
      const next = index === 0 ? [] : cur.includes(index) ? cur.filter((s) => s !== index) : [...cur, index].sort((a, b) => a - b);
      return { ...prev, [pid]: next };
    });
    if (!donHintShown.current) {
      donHintShown.current = true;
      explain(
        "DON!! split — visual only, the game state does not change.",
        "Right-click (long-press on touch) splits; again on a group's first DON!! merges it. Once split, drag a group onto your Leader or a Character to give it.",
        "info",
      );
    }
  };

  /** Group sizes of a seat's active DON!! (left to right) from its split points. */
  const donGroups = (pid: PID): number[] => {
    const active = game.players[pid].don.active;
    const starts = [0, ...(donSplits[pid] ?? []).filter((s) => s > 0 && s < active)];
    return starts.map((s, k) => (starts[k + 1] ?? active) - s);
  };

  /** Drag a DON!! group: pointer down on any DON!! of it, drop on your Leader or a Character. */
  const donDragStart = (pid: PID, index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || pc || pid !== game.turnPlayer || game.phase !== "main" || game.battle) return;
    const groups = donGroups(pid);
    // only a split stack drags: an unsplit one would hand over every DON!! at once
    if (groups.length < 2) return;
    let group = 0;
    for (let start = 0; group < groups.length - 1 && index >= start + groups[group]; group++) start += groups[group];
    donDragRef.current = { pid, count: groups[group], groups, group, x0: e.clientX, y0: e.clientY, active: false };
  };
  const donDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = donDragRef.current;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) return;
      d.active = true;
      donPressEnd();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      setMode({ t: "idle" });
    }
    setDonDrag({ count: d.count, x: e.clientX, y: e.clientY });
  };
  const donDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = donDragRef.current;
    donDragRef.current = null;
    if (!d || !d.active) return;
    longPressed.current = true; // swallow the click that follows the drop
    setDonDrag(null);
    const iid = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-iid]")?.dataset.iid;
    const p = game.players[d.pid];
    if (!iid || (iid !== p.leaderIid && !p.zones.characterArea.includes(iid))) return;
    let given = 0;
    for (; given < d.count; given++) {
      if (!useAutoStore.getState().dispatch({ type: "giveDon", player: d.pid, targetIid: iid })) break;
    }
    if (given === 0) return;
    // the other groups keep their shape
    const left = [...d.groups];
    left[d.group] -= given;
    const sizes = left.filter((n) => n > 0);
    const starts = sizes.slice(0, -1).map((_, k) => sizes.slice(0, k + 1).reduce((a, b) => a + b, 0));
    setDonSplits((prev) => ({ ...prev, [d.pid]: starts }));
  };

  // per-seat chess-style clocks (count up while that seat must act)
  const [clocks, setClocks] = useState<Record<PID, number>>({ [SEAT_A]: 0, [SEAT_B]: 0 });
  useEffect(() => {
    if (game.phase === "over") return;
    const actor = lm.actor;
    const t = setInterval(() => setClocks((c) => ({ ...c, [actor]: (c[actor] ?? 0) + 1 })), 1000);
    return () => clearInterval(t);
  }, [lm.actor, game.phase]);

  // turn toast
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (game.turn < 1) return;
    setToast(`TURN ${game.turn} — ${seatName(game.turnPlayer)}`);
    const t = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.turn, game.turnPlayer]);

  // attack arrow (battle in progress, or an attacker picked and a target hovered)
  const [arrow, setArrow] = useState<Arrow | null>(null);
  // drag-to-attack: the attacker being dragged and where the pointer is (viewport px)
  const atkDragRef = useRef<{ iid: Iid; x0: number; y0: number; active: boolean } | null>(null);
  const [atkPoint, setAtkPoint] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Viewport (client) point → the field overlay's LOCAL coordinates. Uses the
   *  overlay SVG's screen CTM, which includes every CSS transform above it —
   *  so the arrow and the damage animations stay right inside the 90°-rotated
   *  phone table (`.ba-forced`) as well as on desktop. */
  const toLocal = (x: number, y: number): { x: number; y: number } => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM?.();
    if (svg && m) {
      const p = new DOMPoint(x, y).matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }
    const f = fieldRef.current?.getBoundingClientRect();
    return { x: x - (f?.left ?? 0), y: y - (f?.top ?? 0) };
  };
  const centerOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return toLocal(r.left + r.width / 2, r.top + r.height / 2);
  };
  useLayoutEffect(() => {
    let from: Iid | null = null;
    let to: Iid | null = null;
    let owner: PID | null = null;
    if (game.battle) {
      from = game.battle.attackerIid;
      to = game.battle.targetIid;
      owner = game.battle.attackerOwner;
    } else if (mode.t === "attack" && hoverTarget && mode.targets.includes(hoverTarget)) {
      from = mode.iid;
      to = hoverTarget;
      owner = game.turnPlayer;
    } else if (mode.t === "attack" && atkPoint) {
      // dragging an attacker over nothing in particular: the arrow follows the pointer
      const a = nodeMap.current.get(mode.iid);
      if (a) {
        const p = centerOf(a);
        const q = toLocal(atkPoint.x, atkPoint.y);
        setArrow({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, color: leaderHex(game.turnPlayer) });
        return;
      }
    }
    const a = from ? nodeMap.current.get(from) : null;
    const b = to ? nodeMap.current.get(to) : null;
    if (!a || !b || !owner) {
      setArrow(null);
      return;
    }
    const p = centerOf(a);
    const q = centerOf(b);
    setArrow({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, color: leaderHex(owner) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.battle?.attackerIid, game.battle?.targetIid, mode, hoverTarget, atkPoint, events.length]);

  // ── functional micro-animations: Life taken / Character K.O.'d ──────────────
  // transform+opacity only, ≤250ms, skipped under prefers-reduced-motion
  // "cast": an Event card used — rises from the hand to the table centre,
  // holds for a beat (readable), then fades toward the trash (tx/ty)
  interface Fx { id: number; label?: string; kind: "life" | "ko" | "cast" | "reveal" | "counter" | "don"; x: number; y: number; w: number; h: number; dx: number; dy: number; tx?: number; ty?: number; cardId?: string; color?: string; flip?: boolean }
  const [fxList, setFxList] = useState<Fx[]>([]);
  const battleOutcome = (fresh: typeof events): { text: string; sub: string; tone: "hit" | "miss" } | null => {
    const won = fresh.find((e) => e.type === "battleWon");
    const lost = fresh.find((e) => e.type === "battleLost");
    if (!won && !lost) return null;
    const ko = fresh.find((e) => e.type === "characterKOd");
    const lifeHits = fresh.filter((e) => e.type === "lifeCardToHand" || e.type === "lifeCardTrashed").length;
    const nameOf = (iid: string) => cards.get(findCardId(game, iid) ?? "")?.name ?? "the card";
    if (lost && lost.type === "battleLost") return { text: "REPELLED", sub: `${nameOf(lost.targetIid)} holds`, tone: "miss" };
    if (ko && ko.type === "characterKOd") return { text: "K.O.!", sub: `${nameOf(ko.iid)} is K.O.'d`, tone: "hit" };
    return { text: "HIT!", sub: lifeHits ? `${lifeHits} Life card${lifeHits > 1 ? "s" : ""} taken` : "the attack connects", tone: "hit" };
  };
  const [hitSeat, setHitSeat] = useState<PID | null>(null);
  const lastRects = useRef(new Map<Iid, { cx: number; cy: number; w: number; h: number }>());
  const seenEvents = useRef(events.length);
  const fxSeq = useRef(0);
  useLayoutEffect(() => {
    const fresh = events.slice(seenEvents.current);
    seenEvents.current = events.length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const added: Fx[] = [];
    let hit: PID | null = null;
    const flashes: Record<Iid, string> = {};
    const fly = (kind: Fx["kind"], from: { cx: number; cy: number; w: number; h: number } | null, toEl: Element | null, cardId?: string) => {
      if (!from || !toEl) return;
      const q = centerOf(toEl);
      added.push({ id: ++fxSeq.current, kind, x: from.cx - from.w / 2, y: from.cy - from.h / 2, w: from.w, h: from.h, dx: q.x - from.cx, dy: q.y - from.cy, cardId });
    };
    const pileFrom = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const c = centerOf(el);
      return { cx: c.x, cy: c.y, w: el.offsetWidth, h: el.offsetHeight }; // untransformed size
    };
    for (const e of fresh) {
      if (e.type === "lifeCardToHand" || e.type === "lifeCardTrashed") {
        hit = e.player;
        if (!reduce) {
          fly("life", pileFrom(`[data-pile="life-${e.player}"] .ba-lifecard:last-child`) ?? pileFrom(`[data-pile="life-${e.player}"] .ba-pcard`),
            document.querySelector(e.type === "lifeCardToHand" ? `[data-hand="${e.player}"]` : `[data-pile="trash-${e.player}"] .ba-pcard`));
        }
      } else if (e.type === "characterKOd" && !reduce) {
        fly("ko", lastRects.current.get(e.iid) ?? null, document.querySelector(`[data-pile="trash-${e.player}"] .ba-pcard`),
          game.players[e.player]?.instances[e.iid]?.cardId);
      } else if (e.type === "donGiven" || e.type === "donGivenFromRested") {
        flashes[e.targetIid] = "pulse";
        const costArea = document.querySelector(`[data-seat-don="${e.player}"] .ba-donstack`) ?? document.querySelector(`[data-seat-don="${e.player}"]`);
        const targetEl = nodeMap.current.get(e.targetIid) ?? null;
        if (costArea && targetEl && !reduce) {
          const c = centerOf(costArea);
          const n = e.type === "donGivenFromRested" ? Math.min(e.count, MAX_DON_PEEKS) : 1;
          for (let k = 0; k < n; k++) fly("don", { cx: c.x + k * 8, cy: c.y, w: DON_W, h: DON_H }, targetEl);
        }
      } else if (e.type === "attackDeclared") {
        flashes[e.targetIid] = "hit";
      } else if (e.type === "counterApplied") {
        flashes[e.targetIid] = "up";
        const targetEl = nodeMap.current.get(e.targetIid);
        const from = lastRects.current.get(e.cardIid) ?? null; // the hand card, as it was
        if (targetEl && !reduce) {
          const t = centerOf(targetEl);
          const w = CARD_W * 1.5, h = CARD_H * 1.5;
          added.push({
            id: ++fxSeq.current, kind: "counter", x: t.x - w / 2, y: t.y - h / 2, w, h,
            dx: from ? from.cx - t.x : 0, dy: from ? from.cy - t.y : 200,
            cardId: game.players[e.player]?.instances[e.cardIid]?.cardId, color: leaderHex(e.player), label: `+${e.amount}`,
          });
        }
      } else if (e.type === "effectActivated" || e.type === "triggerActivated") {
        flashes[e.type === "effectActivated" ? e.sourceIid : e.iid] = "glow";
      } else if (e.type === "peekResolved" && e.toHand.length && !reduce) {
        const field = fieldRef.current;
        const deckEl = document.querySelector(`[data-pile="deck-${e.player}"] .ba-pcard`);
        const handEl = document.querySelector(`[data-hand="${e.player}"]`);
        if (field && deckEl && handEl) {
          const w = CARD_W * 1.5, h = CARD_H * 1.5;
          const d = centerOf(deckEl), t = centerOf(handEl);
          e.toHand.forEach((iid, k) => {
            const cx = field.offsetWidth / 2 + (k - (e.toHand.length - 1) / 2) * (w + 16), cy = field.offsetHeight / 2;
            added.push({
              id: ++fxSeq.current, kind: "reveal", x: cx - w / 2, y: cy - h / 2, w, h,
              dx: d.x - cx, dy: d.y - cy, tx: t.x - cx, ty: t.y - cy,
              cardId: game.players[e.player]?.instances[iid]?.cardId, color: leaderHex(e.player), flip: hiddenHand(e.player),
            });
          });
        }
      } else if (e.type === "eventCardUsed" && !reduce) {
        const field = fieldRef.current;
        const cardId = game.players[e.player]?.instances[e.iid]?.cardId;
        if (field && cardId) {
          const w = CARD_W * 2, h = CARD_H * 2; // 2× a table card, same 100:140 proportion
          const cx = field.offsetWidth / 2, cy = field.offsetHeight / 2;
          const from = lastRects.current.get(e.iid) ?? null; // the hand card, as it was
          const trashEl = document.querySelector(`[data-pile="trash-${e.player}"] .ba-pcard`);
          const t = trashEl ? centerOf(trashEl) : { x: cx, y: cy + 160 };
          added.push({
            id: ++fxSeq.current, kind: "cast", x: cx - w / 2, y: cy - h / 2, w, h,
            dx: from ? from.cx - cx : 0, dy: from ? from.cy - cy : 140,
            tx: t.x - cx, ty: t.y - cy, cardId, color: leaderHex(e.player),
          });
        }
      }
    }
    if (added.length) {
      setFxList((l) => [...l, ...added]);
      const ids = added.map((f) => f.id);
      window.setTimeout(() => setFxList((l) => l.filter((f) => !ids.includes(f.id))), 2200); // safety net
    }
    const outcome = battleOutcome(fresh);
    if (outcome) {
      setRecap(outcome);
      window.setTimeout(() => setRecap((r) => (r === outcome ? null : r)), RECAP_MS);
    }
    if (hit) {
      setHitSeat(hit);
      window.setTimeout(() => setHitSeat(null), 360);
    }
    const flashed = Object.keys(flashes);
    if (flashed.length && !reduce) {
      setFlash((f) => ({ ...f, ...flashes }));
      window.setTimeout(() => setFlash((f) => {
        const n = { ...f };
        for (const k of flashed) delete n[k];
        return n;
      }), 460);
    }
    // remember where every registered card is, for the NEXT diff (a K.O.'d
    // card is gone from the DOM by the time its event is processed)
    for (const [iid, el] of nodeMap.current) {
      const c = centerOf(el);
      lastRects.current.set(iid, { cx: c.x, cy: c.y, w: el.offsetWidth, h: el.offsetHeight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // ── tap routing ─────────────────────────────────────────────────────────────

  /** A log line with every card name it mentions hoverable (→ preview rail). */
  const withCardNames = (text: string, named?: { name: string; cardId: string }[]): React.ReactNode => {
    if (!named?.length) return text;
    const byName = new Map(named.map((c) => [c.name, c.cardId]));
    const escaped = [...byName.keys()].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return text.split(new RegExp(`(${escaped.join("|")})`)).map((part, k) => {
      const cardId = byName.get(part);
      return cardId
        ? <span key={k} className="ba-logcard" onMouseEnter={() => hover(cardId)} onClick={() => hover(cardId)}>{part}</span>
        : part;
    });
  };
  const hover = (cardId: string | null) => {
    if (!cardId) return;
    const c = cards.get(cardId);
    if (c) setPreview(c);
  };
  /** A tap that performs NO action: the preview rail shows the card (never an
   *  automatic sheet). `ref` is kept for API symmetry with the board taps. */
  const inspect = (cardId: string | null, ref: { owner: PID; iid: Iid } | null = null) => {
    void ref;
    hover(cardId);
  };

  /** Play a hand card (from the in-place PLAY button). */
  const playFromHand = (owner: PID, iid: Iid) => {
    const playable = lm.playableFromHand.find((x) => x.iid === iid);
    if (!playable) return;
    const card = cards.get(game.players[owner].instances[iid].cardId);
    setSelectedHand(null);
    if (playable.needsReplace && card?.category === "Character") {
      setMode({ t: "replace", handIid: iid });
      return;
    }
    setMode({ t: "idle" });
    dispatch({ type: "playCard", player: owner, iid });
  };

  const toggleTarget = (iid: Iid) => {
    if (pc?.kind !== "selectTargets") return;
    if (!pc.candidates.some((c) => c.iid === iid)) {
      explain("Not a legal target for this effect.", "Legal targets carry the red corner ring.");
      return;
    }
    const max = Math.min(pc.count, pc.candidates.length);
    const next = picked.includes(iid) ? picked.filter((x) => x !== iid) : picked.length >= max ? picked : [...picked, iid];
    setPicked(next);
    // the last target needed resolves the choice (unless "confirm every choice" is on)
    if (!confirmPicks && next.length === max && next.length > picked.length && setOk(pc, next)) {
      dispatch({ type: "respondTargets", player: pc.player, iids: next });
    }
  };

  const whyNotPlayable = (owner: PID, iid: Iid) => {
    const p = game.players[owner];
    const card = db(p.instances[iid].cardId);
    if (game.phase !== "main" || game.battle) {
      explain("Cards are played in the Main Phase, outside battle.");
      return;
    }
    if ((card.cost ?? 0) > p.don.active) {
      explain(`Not enough active DON!! (${p.don.active}/${card.cost ?? 0}).`, "Wait for the DON!! Phase or spend less this turn.");
      return;
    }
    if (card.category === "Event") {
      explain("This Event has no [Main] effect (10-2-3).", "A [Counter] Event is used while defending, in the Counter Step.");
      return;
    }
    explain("This card can't be played right now.");
  };

  /** Counter Step: a hand card used as a counter (tapped or dragged onto the board). */
  const counterWith = (owner: PID, iid: Iid) => {
    if (lm.counterCards.some((c) => c.iid === iid) && game.battle) {
      dispatch({ type: "useCounter", player: owner, cardIid: iid, targetIid: game.battle.targetIid });
      return;
    }
    if (lm.counterEvents.some((c) => c.iid === iid)) {
      dispatch({ type: "useCounterEvent", player: owner, cardIid: iid });
      return;
    }
    explain("This card can't counter.", "Usable now: cards with a counter value, or [Counter] Events you can pay.");
  };

  const onHandTap = (owner: PID, iid: Iid) => {
    const inst = game.players[owner].instances[iid];
    hover(inst.cardId);
    if (pc?.kind === "selectTargets") {
      toggleTarget(iid);
      return;
    }
    if (pc?.kind === "counterWindow" && pc.player === owner) {
      counterWith(owner, iid);
      return;
    }
    if (pc) { inspect(inst.cardId); return; } // other prompts: tap = preview only
    if (game.phase !== "main" || game.battle) { inspect(inst.cardId); return; }
    if (owner !== game.turnPlayer) {
      explain("Not this seat's turn.", `${seatName(game.turnPlayer)} is acting.`);
      inspect(inst.cardId);
      return;
    }
    const playable = lm.playableFromHand.find((x) => x.iid === iid);
    if (!playable) {
      whyNotPlayable(owner, iid);
      inspect(inst.cardId);
      return;
    }
    // tap = select (shows the in-place PLAY button); tap again = deselect.
    // Playing happens ONLY through PLAY (no accidental plays, any device).
    setSelectedHand(selectedHand === iid ? null : iid);
    inspect(inst.cardId);
  };

  const onBoardTap = (owner: PID, iid: Iid) => {
    const cardId = findCardId(game, iid);
    hover(cardId);
    if (restSplit?.candidates.has(iid)) {
      pickRest(donPick, picked.includes(iid) ? picked.filter((x) => x !== iid) : [...picked, iid]);
      return;
    }
    if (pc?.kind === "selectTargets") {
      toggleTarget(iid);
      return;
    }
    if (pc?.kind === "blockWindow" && pc.player === owner && pc.blockers.includes(iid)) {
      dispatch({ type: "respondBlock", player: owner, blockerIid: iid });
      return;
    }
    if (pc?.kind === "payDon" && owner === pc.player && (game.players[owner].don.given[iid] ?? 0) > 0) {
      pickPayDon(owner, iid);
      return;
    }
    if (pc) { inspect(cardId, { owner, iid }); return; }

    if (mode.t === "don") {
      const me = game.turnPlayer;
      const p = game.players[me];
      if (owner === me && (iid === p.leaderIid || p.zones.characterArea.includes(iid))) {
        const n = mode.picked.length;
        setMode({ t: "idle" });
        for (let i = 0; i < n; i++) {
          if (!useAutoStore.getState().dispatch({ type: "giveDon", player: me, targetIid: iid })) break;
        }
      } else {
        setMode({ t: "idle" }); // cancel: tapped elsewhere
      }
      return;
    }

    if (mode.t === "replace") {
      const me = game.turnPlayer;
      if (owner === me && game.players[me].zones.characterArea.includes(iid)) {
        const handIid = mode.handIid;
        setMode({ t: "idle" });
        dispatch({ type: "playCard", player: me, iid: handIid, replaceIid: iid });
      } else {
        setMode({ t: "idle" });
      }
      return;
    }

    if (mode.t === "attack" && mode.targets.includes(iid)) {
      const attacker = mode.iid;
      setMode({ t: "idle" });
      dispatch({ type: "attack", player: game.turnPlayer, attackerIid: attacker, targetIid: iid });
      return;
    }

    // main window: picking (or switching) an attacker
    if (game.phase === "main" && !game.battle && owner === game.turnPlayer) {
      const a = lm.attackers.find((x) => x.iid === iid);
      if (a) {
        setMode({ t: "attack", iid, targets: a.targets });
        return;
      }
      if ((mode.t === "attack" || mode.t === "card") && mode.iid === iid) {
        setMode({ t: "idle" }); // a second tap deselects
        return;
      }
      const inst = game.players[owner].instances[iid];
      const p = game.players[owner];
      const isBoard = iid === p.leaderIid || p.zones.characterArea.includes(iid) || p.zones.stage.includes(iid);
      if (isBoard) setMode({ t: "card", iid });
      // an [Activate: Main] that is NOT legal now gets its reason explained
      const compiled = cardId ? db(cardId).compiled : undefined;
      const amIdx = compiled?.effects.findIndex((fx) => fx.timing === "activateMain") ?? -1;
      if (isBoard && amIdx >= 0 && !lm.activatable.some((a) => a.iid === iid)) {
        const used = !!compiled!.effects[amIdx].oncePerTurn && game.oncePerTurnUsed[`${owner}:${iid}:${amIdx}`] === game.turn;
        explain(
          used ? "[Activate: Main] already used this turn (10-2-13-3)." : "[Activate: Main] not available right now.",
          used
            ? "It is usable again on your next turn."
            : "Its conditions aren't met or its cost can't be paid (e.g. no rested DON!! to give, DON!!−X unaffordable).",
        );
      } else if (isBoard && inst.rested) explain("This card is rested — it already acted.", "It stands in your next Refresh Phase.");
      else if (isBoard && game.turn <= 2) explain("No battles on either player's first turn (6-5-6-1).");
      inspect(cardId, { owner, iid });
      return;
    }
    if (mode.t === "attack" || mode.t === "card") { setMode({ t: "idle" }); return; }
    inspect(cardId, { owner, iid });
  };

  /** One DON!! from the cost area to a card (the bar's "+1 DON!!"). */
  const giveOneDon = (iid: Iid) => {
    dispatch({ type: "giveDon", player: game.turnPlayer, targetIid: iid }); // the donGiven event pulses the card
  };

  /** [Activate: Main] (10-2-2, M3): only ever offered from legality.activatable. */
  const activate = (owner: PID, iid: Iid, effectIndex: number) => {
    setMode({ t: "idle" });
    dispatch({ type: "activateMain", player: owner, iid, effectIndex });
  };

  /** DON!!−X: one click = one DON!! picked (again = unpicked); the last one pays. */
  const pickPayDon = (owner: PID, where: "active" | "rested" | Iid, index = 0) => {
    if (pc?.kind !== "payDon" || owner !== pc.player) return;
    const p = game.players[owner];
    const next = { active: [...payPick.active], rested: [...payPick.rested], given: { ...payPick.given } };
    if (where === "active" || where === "rested") {
      const list = next[where];
      const at = list.indexOf(index);
      if (at >= 0) list.splice(at, 1); else list.push(index);
    } else {
      // a card's given DON!!: each click takes one more, past the last it puts them all back
      const cur = next.given[where] ?? 0;
      next.given[where] = cur >= (p.don.given[where] ?? 0) ? 0 : cur + 1;
    }
    const total = next.active.length + next.rested.length + Object.values(next.given).reduce((a, b) => a + b, 0);
    if (total > pc.amount) return;
    setPayPick(next);
    if (total === pc.amount && !confirmPicks) payDonWith(next);
  };
  const payDonWith = (pick: typeof payPick) => {
    if (pc?.kind !== "payDon") return;
    const fromGiven = Object.fromEntries(Object.entries(pick.given).filter(([, n]) => n > 0));
    dispatch({ type: "respondPayDon", player: pc.player, fromActive: pick.active.length, fromRested: pick.rested.length, fromGiven });
  };

  /** One click on a DON!! (or the DON!! deck) toward a DON!!-moving effect;
   *  reaching the maximum resolves it. False when no such effect wants it. */
  const pickDon = (owner: PID, where: DonChoice["from"], index: number): boolean => {
    if (!donChoice || owner !== pc?.player || where !== donChoice.from) return false;
    const full = donPick.length >= donChoice.max;
    const next = where === "deck"
      ? (full ? [] : [...donPick, donPick.length + 1])
      : donPick.includes(index) ? donPick.filter((i) => i !== index) : full ? donPick : [...donPick, index];
    setDonPick(next);
    if (!confirmPicks && next.length === donChoice.max && donChoice.max > 0) dispatch(donChoice.answer(next.length));
    return true;
  };

  /** Pay a split rest cost with what was clicked: the split it makes, then the
   *  cards it names (the engine asks them next, unless they are the only ones). */
  const payRest = (don: number, iids: Iid[]) => {
    if (!restSplit || !pc) return;
    const index = restSplit.optionFor(don);
    if (index < 0) {
      explain("This cost can't be paid that way.");
      setDonPick([]);
      setPicked([]);
      return;
    }
    if (!dispatch({ type: "respondOption", player: pc.player, index })) return;
    const next = useAutoStore.getState().game?.pendingChoice;
    if (next?.kind === "selectTargets" && iids.length > 0) dispatch({ type: "respondTargets", player: next.player, iids });
  };
  /** One click toward a split rest cost; the last one needed pays it. */
  const pickRest = (don: number[], iids: Iid[]) => {
    if (!restSplit || don.length > restSplit.donMax || iids.length > restSplit.cardMax || don.length + iids.length > restSplit.total) return;
    setDonPick(don);
    setPicked(iids);
    if (!confirmPicks && don.length + iids.length === restSplit.total) payRest(don.length, iids);
  };

  const onDonTap = (owner: PID, index: number) => {
    if (restSplit && owner === pc?.player) {
      pickRest(donPick.includes(index) ? donPick.filter((i) => i !== index) : [...donPick, index], picked);
      return;
    }
    if (pickDon(owner, "active", index)) return;
    if (pc?.kind === "payDon") { pickPayDon(owner, "active", index); return; }
    if (pc) return;
    if (game.phase !== "main" || game.battle) return;
    if (owner !== game.turnPlayer) {
      explain("DON!! can be given only in your own Main Phase (6-5-5).");
      return;
    }
    // one tap = toggle THAT DON!! only (user request: no quantity dial)
    const cur = mode.t === "don" ? mode.picked : [];
    const next = cur.includes(index) ? cur.filter((i) => i !== index) : [...cur, index];
    setMode(next.length === 0 ? { t: "idle" } : { t: "don", picked: next });
  };
  const selectAllDon = () => {
    const active = game.players[game.turnPlayer].don.active;
    setMode(active > 0 ? { t: "don", picked: Array.from({ length: active }, (_, i) => i + 1) } : { t: "idle" });
  };

  // ── action bar (ONE contextual button, bottom-center) ───────────────────────

  /** selectTargets whose candidates live in a pile (trash / deck / Life):
   *  they get the picker overlay instead of the on-table prompt. */
  const pileCandidates = pc?.kind === "selectTargets" && pc.candidates.some((c) => {
    const p = game.players[c.owner];
    return !(c.iid === p.leaderIid || p.zones.characterArea.includes(c.iid) || p.zones.stage.includes(c.iid) || p.zones.hand.includes(c.iid));
  });

  const actionBar = (() => {
    if (game.phase === "over") return null;
    if (pc?.kind === "mulligan") {
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            <b>{seatName(pc.player)}</b> — keep this hand? <i>One mulligan: reshuffle and draw 5 new.</i>
          </span>
          <button className="ba-btn primary" data-act="keep" onClick={() => dispatch({ type: "respondMulligan", player: pc.player, take: false })}>
            Keep
          </button>
          <button className="ba-btn" data-act="mulligan" onClick={() => dispatch({ type: "respondMulligan", player: pc.player, take: true })}>
            Mulligan
          </button>
        </div>
      );
    }
    if (restSplit && pc?.kind === "chooseOption") {
      const n = donPick.length + picked.length;
      const src = cards.get(findCardId(game, pc.sourceIid) ?? "")?.name;
      return (
        <div className="ba-actionbar" data-restsplit>
          <span className="ba-actlabel">
            {src && <b>{src}</b>} — click what to rest{restSplit.donMax > 0 ? ": a DON!!" : ""}{restSplit.cardMax > 0 ? " or a card" : ""} <i>{n}/{restSplit.total}</i>
          </span>
          {n > 0 && <button className="ba-btn" data-act="restsplit-clear" onClick={() => { setDonPick([]); setPicked([]); }}>Clear</button>}
          {confirmPicks && <button className="ba-btn primary" data-act="restsplit-confirm" disabled={n < restSplit.total} onClick={() => payRest(donPick.length, picked)}>Confirm ({n})</button>}
        </div>
      );
    }
    if (donChoice && pc) {
      const n = donPick.length;
      const src = cards.get(findCardId(game, donChoice.sourceIid) ?? "")?.name;
      const where = donChoice.from === "active" ? "active DON!! in your cost area" : donChoice.from === "rested" ? "rested DON!! in your cost area" : "your DON!! deck";
      return (
        <div className="ba-actionbar" data-donpick={donChoice.from}>
          <span className="ba-actlabel">
            {src && <b>{src}</b>} — click {donChoice.from === "deck" ? "" : `up to ${donChoice.max} `}{where} to {donChoice.verb}
            {donChoice.from === "deck" ? ` (up to ${donChoice.max})` : ""} <i>{n}/{donChoice.max}</i>
          </span>
          {n > 0 && <button className="ba-btn" data-act="donpick-clear" onClick={() => setDonPick([])}>Clear</button>}
          <button className="ba-btn primary" data-act="donpick-confirm" disabled={n < donChoice.min} onClick={() => dispatch(donChoice.answer(n))}>
            {n === 0 ? "None" : `Confirm (${n})`}
          </button>
        </div>
      );
    }
    if (pc?.kind === "payDon") {
      const picked = payPick.active.length + payPick.rested.length + Object.values(payPick.given).reduce((a, b) => a + b, 0);
      return (
        <div className="ba-actionbar" data-paydon>
          <span className="ba-actlabel">
            <b>{seatName(pc.player)}</b> — DON!!−{pc.amount}: click {pc.amount === 1 ? "the DON!!" : `${pc.amount} DON!!`} to return
            (cost area, or a card with DON!! given) <i>{picked}/{pc.amount}</i>
          </span>
          {picked > 0 && (
            <button className="ba-btn" data-act="paydon-clear" onClick={() => setPayPick({ active: [], rested: [], given: {} })}>Clear</button>
          )}
          {confirmPicks && (
            <button className="ba-btn primary" data-act="paydon-confirm" disabled={picked !== pc.amount} onClick={() => payDonWith(payPick)}>
              Confirm ({picked})
            </button>
          )}
        </div>
      );
    }
    if (pc?.kind === "blockWindow") {
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            <b>{seatName(pc.player)}</b> — block? Tap a highlighted [Blocker], or:
          </span>
          <button className="ba-btn primary big" data-act="noblock" onClick={() => dispatch({ type: "respondBlock", player: pc.player, blockerIid: null })}>
            Don't block
          </button>
        </div>
      );
    }
    if (pc?.kind === "counterWindow") {
      const usable = lm.counterCards.length + lm.counterEvents.length;
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            <b>{seatName(pc.player)}</b> — counter step: {usable > 0 ? "tap highlighted cards in hand (repeatable), then" : "nothing usable in hand —"}
          </span>
          <button className="ba-btn primary big" data-act="endcounters" onClick={() => dispatch({ type: "passCounter", player: pc.player })}>
            End counters
          </button>
        </div>
      );
    }
    if (pc?.kind === "selectTargets" && !pileCandidates) {
      const max = Math.min(pc.count, pc.candidates.length);
      const ok = (pc.upTo ? picked.length <= max : picked.length === max) && setOk(pc, picked);
      // cost phase (M3: trash from hand / return to hand / rest / hand→deck
      // bottom) vs effect targets — the running effect tells which
      const r = game.exec?.running;
      const paying = !!r && r.costIndex < r.costs.length;
      const n = pc.upTo ? `up to ${pc.count}` : `${max}`;
      const plural = max === 1 ? "" : "s";
      const COST_LABEL: Record<string, string> = {
        discard: `trash ${n} card${plural} from your hand`,
        returnToHand: `return ${n} card${plural} to hand`,
        restTarget: `rest ${n} card${plural}`,
        returnToDeck: `put ${n} card${plural} at the bottom of your deck`,
        koTarget: `K.O. ${n} of your Character${plural}`,
        trashTarget: `trash ${n} of your card${plural} on the field`,
        reveal: `reveal ${n} card${plural} from your hand`,
        giveActiveDon: "give active DON!! to",
        giveRestedDon: "give rested DON!! to",
        powerMod: "give the power change to",
      };
      const ACTION_LABEL: Record<string, string> = {
        koTarget: "K.O.", powerMod: "power change", restTarget: "rest", standTarget: "stand",
        discard: "discard", grantKeyword: "keyword", restriction: "restriction",
        returnToHand: "return to hand", playFromZone: "play", giveRestedDon: "give rested DON!! to",
        addFromTrashToHand: "return from trash", attachDonFromDeck: "attach DON!! to",
        costMod: "cost change", returnToDeck: "return to deck",
        trashTarget: "trash", reveal: "reveal", giveActiveDon: "give active DON!! to",
      };
      const title = paying
        ? `Pay the cost: ${COST_LABEL[pc.actionKind] ?? `${pc.actionKind} (${n})`}`
        : `choose ${n} target${plural} — ${ACTION_LABEL[pc.actionKind] ?? pc.actionKind}`
          + (pc.totalCostAtMost !== undefined ? ` (total cost ≤ ${pc.totalCostAtMost})` : "")
          + (pc.totalPowerAtMost !== undefined ? ` (total power ≤ ${pc.totalPowerAtMost})` : "")
          + (pc.distinctNames ? " (different names)" : "");
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            <b>{seatName(pc.player)}</b> — {title}
          </span>
          <button
            className="ba-btn primary"
            data-act="confirm-targets"
            disabled={!ok}
            onClick={() => dispatch({ type: "respondTargets", player: pc.player, iids: picked })}
          >
            {pc.upTo && picked.length === 0 ? "None" : `Confirm (${picked.length})`}
          </button>
        </div>
      );
    }
    if (mode.t === "don") {
      const active = game.players[game.turnPlayer].don.active;
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel" data-don-selected={mode.picked.length}>
            <b>{mode.picked.length} DON!! selected</b> — tap your Leader or a Character to give them. Tap a DON!! again to deselect it.
          </span>
          {mode.picked.length < active && (
            <button className="ba-btn" data-act="don-all" onClick={(e) => { e.stopPropagation(); selectAllDon(); }}>All ({active})</button>
          )}
          <button className="ba-btn" data-act="cancel" onClick={() => setMode({ t: "idle" })}>Cancel</button>
        </div>
      );
    }
    if (mode.t === "attack" || mode.t === "card") {
      const me = game.turnPlayer;
      const name = cards.get(findCardId(game, mode.iid) ?? "")?.name ?? "Card";
      const acts = lm.activatable.filter((a) => a.iid === mode.iid);
      const canDon = game.players[me].don.active > 0 && (mode.iid === game.players[me].leaderIid || game.players[me].zones.characterArea.includes(mode.iid));
      return (
        <div className="ba-actionbar ba-cardbar" data-cardbar={mode.t}>
          <span className="ba-actlabel">
            <b>{name}</b>{" "}
            {mode.t === "attack" ? <>— <span className="ba-atkhint">⚔ drag it onto a glowing target, or tap the target</span></> : <i>— {cardIdleReason(me, mode.iid)}</i>}
          </span>
          {acts.map((a) => (
            <button key={a.effectIndex} className="ba-btn ba-bigact act" data-act="bar-activate" onClick={() => activate(me, mode.iid, a.effectIndex)}>⚡ Activate</button>
          ))}
          {canDon && <button className="ba-btn ba-bigact don" data-act="bar-don" onClick={() => giveOneDon(mode.iid)}>+1 DON!!</button>}
          <button className="ba-btn" data-act="cancel" onClick={() => setMode({ t: "idle" })}>Cancel <i>(Esc)</i></button>
        </div>
      );
    }
    if (mode.t === "replace") {
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">Character area full (5) — tap one of your Characters to trash and replace (3-7-6-1).</span>
          <button className="ba-btn" data-act="cancel" onClick={() => setMode({ t: "idle" })}>Cancel</button>
        </div>
      );
    }
    // nothing selected in your Main Phase: say what you can do right now
    if (!pc && game.phase === "main" && !game.battle && selectedHand) {
      const can = lm.playableFromHand.some((x) => x.iid === selectedHand);
      return (
        <div className="ba-actionbar ba-cardbar">
          <span className="ba-actlabel"><b>{cards.get(findCardId(game, selectedHand) ?? "")?.name}</b> <i>— {can ? "drag it onto your side, or" : "can't be played now"}</i></span>
          {can && <button className="ba-btn ba-bigact play" data-act="bar-play" onClick={() => playFromHand(game.turnPlayer, selectedHand)}>▶ Play</button>}
          <button className="ba-btn" data-act="cancel" onClick={() => setSelectedHand(null)}>Cancel <i>(Esc)</i></button>
        </div>
      );
    }
    if (!pc && game.phase === "main" && !game.battle && !isAiSeat(seats, game.turnPlayer)) {
      const ready = lm.attackers.length;
      const playable = lm.playableFromHand.length;
      const don = game.players[game.turnPlayer].don.active;
      return (
        <div className="ba-actionbar ba-hintbar" data-hintbar>
          {ready > 0 && <span className="ba-hint atk">⚔ <b>{ready}</b> ready to attack <i>— tap or drag a glowing card</i></span>}
          {playable > 0 && <span className="ba-hint play">▶ <b>{playable}</b> playable <i>— drag from your hand</i></span>}
          {don > 0 && <span className="ba-hint don">DON!! <b>{don}</b> <i>— tap them, then a card</i></span>}
          {ready === 0 && playable === 0 && don === 0 && <span className="ba-hint">Nothing left to do — <b>End turn</b> <i>(E)</i></span>}
        </div>
      );
    }
    return null;
  })();

  /** The battle, readable: who attacks whom, both powers live, what the
   *  defender still needs, the counters already played; then the outcome. */
  function BattleHud() {
    const b = game.battle;
    if (!b) {
      return recap ? (
        <div className={`ba-battlehud recap ${recap.tone}`} data-battle-recap>
          <b>{recap.text}</b>
          <span>{recap.sub}</span>
        </div>
      ) : null;
    }
    const atk = effectivePower(db, game, b.attackerOwner, b.attackerIid);
    const def = effectivePower(db, game, b.defenderOwner, b.targetIid);
    const name = (iid: Iid) => cards.get(findCardId(game, iid) ?? "")?.name ?? "?";
    const start = events.map((e) => e.type).lastIndexOf("attackDeclared");
    const counters = events.slice(start).flatMap((e) => (e.type === "counterApplied" ? [{ name: name(e.cardIid), amount: e.amount }] : []));
    const blocked = events.slice(start).find((e) => e.type === "blockWindowResolved" && e.blockerIid);
    const need = atk - def; // the attack connects at atk >= def (7-1-4)
    const stepLabel = b.step === "block" ? "Block step" : b.step === "counter" ? "Counter step" : b.step === "damage" ? "Damage" : "Attack";
    return (
      <div className="ba-battlehud" data-battle-hud style={{ ["--lc" as string]: leaderHex(b.attackerOwner) }}>
        <span className="ba-bh-step">{stepLabel}{blocked ? " · blocked" : ""}</span>
        <div className="ba-bh-row">
          <span className="ba-bh-side"><i>{name(b.attackerIid)}</i><b>{atk}</b></span>
          <span className="ba-bh-vs"><PixelIcon name="swords" size={24} /></span>
          <span className="ba-bh-side def"><i>{name(b.targetIid)}</i><b>{def}</b></span>
        </div>
        <span className={`ba-bh-need${need >= 0 ? " hits" : " safe"}`}>
          {need >= 0 ? `Hits — the defender needs +${need + 1000 - (need % 1000)} to stop it` : "Repelled at these powers"}
        </span>
        {counters.length > 0 && (
          <span className="ba-bh-counters">{counters.map((c, i) => <em key={i}>{c.name} +{c.amount}</em>)}</span>
        )}
      </div>
    );
  }

  /** Why a selected card of yours has no attack right now (shown in the bar). */
  function cardIdleReason(owner: PID, iid: Iid): string {
    const p = game.players[owner];
    if (p.zones.stage.includes(iid)) return "Stage";
    if (p.instances[iid].rested) return "rested: it already acted this turn";
    if (game.turn <= 2) return "no battles on either player's first turn";
    if (iid !== p.leaderIid && p.instances[iid].playedOnTurn === game.turn) return "just played: it can attack next turn (no [Rush])";
    return "can't attack right now";
  }

  // ── board pieces ────────────────────────────────────────────────────────────

  const highlightSets = useMemo(() => {
    const legal = new Set<Iid>();
    const target = new Set<Iid>();
    /** ready attackers in your Main Phase: a pulsing glow + a ⚔ badge */
    const ready = new Set<Iid>();
    if (pc?.kind === "blockWindow") for (const b of pc.blockers) legal.add(b);
    if (pc?.kind === "counterWindow") {
      for (const c of lm.counterCards) legal.add(c.iid);
      for (const c of lm.counterEvents) legal.add(c.iid);
    }
    if (pc?.kind === "selectTargets") for (const c of pc.candidates) target.add(c.iid);
    if (restSplit) for (const iid of restSplit.candidates) target.add(iid);
    if (!pc && game.phase === "main" && !game.battle) {
      if (mode.t === "attack") for (const t of mode.targets) target.add(t);
      else if (mode.t === "don") {
        const p = game.players[game.turnPlayer];
        target.add(p.leaderIid);
        for (const c of p.zones.characterArea) target.add(c);
      } else if (mode.t === "replace") {
        for (const c of game.players[game.turnPlayer].zones.characterArea) target.add(c);
      } else {
        for (const a of lm.attackers) ready.add(a.iid);
        for (const h of lm.playableFromHand) legal.add(h.iid);
      }
    }
    return { legal, target, ready };
  }, [pc, lm, mode, game]);

  // NOTE: the pieces below are RENDER FUNCTIONS, not components — GameScreen
  // re-renders every second (clocks), and a component type defined inside the
  // render would remount its whole subtree each time.
  function BCard({ owner, iid, small, inHand }: { owner: PID; iid: Iid; small?: boolean; inHand?: boolean }) {
    const p = game.players[owner];
    const inst = p.instances[iid];
    const card = cards.get(inst.cardId);
    const isLeader = iid === p.leaderIid;
    const onField = isLeader || p.zones.characterArea.includes(iid) || p.zones.stage.includes(iid);
    const kws = onField ? [...keywordsOf(db, game, owner, iid)] : [];
    // automation disclosure chips: an effect that can't run must never look
    // like silent breakage (shown on field cards; details in the preview)
    const autoInfo = onField && card ? automationInfo(card) : null;
    const basePower = card?.power ?? null;
    const eff = onField && basePower != null ? effectivePower(db, game, owner, iid) : null;
    const delta = eff != null && basePower != null ? eff - basePower : 0;
    const given = p.don.given[iid] ?? 0;
    // stunned: frozen (won't become active next Refresh) or kept from
    // attacking by the opponent's effect — shown big across the card
    const stunned = onField && game.modifiers.some((m) => m.kind === "restriction" && m.targetOwner === owner && m.targetIid === iid
      && (m.restriction === "skipNextRefresh" || (m.restriction === "cannotAttack" && m.controller !== owner)));
    const cls = [
      "gb-card",
      "ba-card",
      inst.rested ? "gb-rested" : "",
      small ? "ba-small" : "",
      highlightSets.legal.has(iid) ? "ba-legal" : "",
      highlightSets.target.has(iid) ? "ba-target" : "",
      picked.includes(iid) || (inHand && selectedHand === iid) ? "ba-picked" : "",
      mode.t === "attack" && mode.iid === iid ? "ba-attacker" : "",
      mode.t === "card" && mode.iid === iid ? "ba-selected" : "",
      highlightSets.ready.has(iid) && !isAiSeat(seats, owner) ? "ba-ready" : "",
      flash[iid] ? `ba-fl-${flash[iid]}` : "",
      drag?.iid === iid ? "ba-dragging" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // drag-to-play (hand, own turn, no prompt): the card follows the pointer
    // as a ghost; dropping it over the owner's half plays it (legality-checked
    // by playFromHand — an illegal drop just explains why, like a tap would).
    // Counter Step: a hand card dropped anywhere on the table counters with it.
    const counterDrag = inHand && pc?.kind === "counterWindow" && pc.player === owner;
    const canDrag = counterDrag || (inHand && !pc && owner === game.turnPlayer && game.phase === "main" && !game.battle);
    // drag-to-attack (a ready attacker on the field): the arrow follows the
    // pointer, legal targets light up; dropping on one declares the attack
    const attackOpt = !inHand && !pc && owner === game.turnPlayer && game.phase === "main" && !game.battle
      ? lm.attackers.find((a) => a.iid === iid) : undefined;
    const targetUnder = (x: number, y: number, targets: Iid[]): Iid | null => {
      const t = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-iid]")?.dataset.iid;
      return t && targets.includes(t) ? t : null;
    };
    const attackDragHandlers = attackOpt
      ? {
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            atkDragRef.current = { iid, x0: e.clientX, y0: e.clientY, active: false };
          },
          onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = atkDragRef.current;
            if (!d || d.iid !== iid) return;
            if (!d.active) {
              if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) return;
              d.active = true;
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
              setMode({ t: "attack", iid, targets: attackOpt.targets });
            }
            setHoverTarget(targetUnder(e.clientX, e.clientY, attackOpt.targets));
            setAtkPoint({ x: e.clientX, y: e.clientY });
          },
          onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = atkDragRef.current;
            atkDragRef.current = null;
            if (!d || !d.active) return;
            suppressClick.current = true;
            setAtkPoint(null);
            setHoverTarget(null);
            setMode({ t: "idle" });
            const target = targetUnder(e.clientX, e.clientY, attackOpt.targets);
            if (target) dispatch({ type: "attack", player: owner, attackerIid: iid, targetIid: target });
          },
          onPointerCancel: () => { atkDragRef.current = null; setAtkPoint(null); setMode({ t: "idle" }); },
        }
      : {};
    const dragHandlers = canDrag
      ? {
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            dragRef.current = { iid, owner, x0: e.clientX, y0: e.clientY, active: false };
          },
          onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = dragRef.current;
            if (!d || d.iid !== iid) return;
            if (!d.active) {
              if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) return;
              d.active = true;
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
              setSelectedHand(null);
            }
            setDrag({ iid, owner, cardId: inst.cardId, x: e.clientX, y: e.clientY });
          },
          onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d || !d.active) return;
            suppressClick.current = true;
            setDrag(null);
            const half = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-half]");
            if (counterDrag) {
              if (half) counterWith(owner, iid);
            } else if (half?.dataset.half === owner) {
              if (lm.playableFromHand.some((x) => x.iid === iid)) playFromHand(owner, iid);
              else whyNotPlayable(owner, iid);
            }
          },
          onPointerCancel: () => { dragRef.current = null; setDrag(null); },
        }
      : {};
    const cardEl = (
      <div
        key={iid}
        className={cls}
        data-iid={iid}
        ref={reg(iid)}
        {...dragHandlers}
        {...attackDragHandlers}
        // no native image drag: its ghost picture "lifted" the card and ate the
        // pointer moves, so the attack arrow only showed after the drop
        onDragStart={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (inHand) onHandTap(owner, iid);
          else onBoardTap(owner, iid);
        }}
        onMouseEnter={() => {
          hover(inst.cardId);
          if (mode.t === "attack") setHoverTarget(iid);
        }}
        onMouseLeave={() => {
          if (mode.t === "attack") setHoverTarget((h) => (h === iid ? null : h));
        }}
      >
        <CardArt inst={{ instanceId: iid, cardId: inst.cardId, faceUp: true, rested: inst.rested }} card={card} isLeader={isLeader} />
        {eff != null && (
          <span className={`ba-power${delta > 0 ? " up" : delta < 0 ? " down" : ""}`}>
            {eff}
            {delta !== 0 && <i>{` ${delta > 0 ? "+" : ""}${delta}`}</i>}
          </span>
        )}
        {inHand && card && <span className="ba-cost">{card.cost ?? 0}</span>}
        {(kws.length > 0 || autoInfo?.manual || autoInfo?.inert) && (
          <span className="ba-kwrow">
            {kws.map((k) => (
              <i key={k} className="ba-kw">{KW_LABEL[k]}</i>
            ))}
            {autoInfo?.manual && <i className="ba-kw manual" title="Some effects resolve via the manual panel">MANUAL</i>}
            {autoInfo?.inert && <i className="ba-kw noauto" title="Some effect text is not automated yet — see the preview panel">NO-AUTO</i>}
          </span>
        )}
        {stunned && <span className="ba-stunned" data-stunned>STUNNED</span>}
        {given > 0 && (
          <span className={`ba-given${pc?.kind === "payDon" && payPick.given[iid] ? " ba-paying" : ""}`}>
            DON!! ×{given}{pc?.kind === "payDon" && payPick.given[iid] ? ` · −${payPick.given[iid]}` : ""}
          </span>
        )}
        {highlightSets.ready.has(iid) && !isAiSeat(seats, owner) && <span className="ba-readybadge" title="Ready to attack — tap or drag"><PixelIcon name="swords" size={12} /></span>}
        {/* in-place PLAY: the selected hand card, when the play is legal now */}
        {inHand && selectedHand === iid && !pc && owner === game.turnPlayer && lm.playableFromHand.some((x) => x.iid === iid) && (
          <button
            className="ba-playbtn"
            data-act="play"
            data-iid={iid}
            onClick={(e) => {
              e.stopPropagation();
              playFromHand(owner, iid);
            }}
          >
            PLAY
          </button>
        )}
        {/* [Activate: Main] affordance = legality only (10-2-2, M3) */}
        {onField && !pc && owner === game.turnPlayer &&
          lm.activatable
            .filter((a) => a.iid === iid)
            .map((a) => (
              <button
                key={a.effectIndex}
                className="ba-activate"
                data-act="activate"
                data-iid={iid}
                data-effect={a.effectIndex}
                title="[Activate: Main] — usable now"
                onClick={(e) => {
                  e.stopPropagation();
                  activate(owner, iid, a.effectIndex);
                }}
              >
                ACTIVATE
              </button>
            ))}
      </div>
    );
    // DON!! given to a card sit UNDER it, a few px apart, like at a real
    // table: you see how many, and that they belong to that card
    if (!onField || given === 0) return cardEl;
    return (
      <Fragment key={iid}>
        {Array.from({ length: Math.min(given, MAX_DON_PEEKS) }).map((_, k) => (
          <span key={`don${k}`} className={`ba-donpeek${inst.rested ? " rested" : ""}`} style={{ ["--k" as string]: k }} aria-hidden>
            <DonArt />
          </span>
        ))}
        {cardEl}
      </Fragment>
    );
  }

  function PileBox({ label, count, children, faceClass, pid, tick, faces, picking, onPick }: { label: string; count: number; children?: React.ReactNode; faceClass?: string; pid: PID; tick?: boolean; faces?: (Card | null)[];
    /** an effect takes cards from this pile by clicks: how many are picked so far */
    picking?: number; onPick?: () => void }) {
    const key = `${label.toLowerCase().replace(/[^a-z]/g, "")}-${pid}`; // life-seatA, trash-seatA, …
    return (
      <div
        className={`ba-pile ${faceClass ?? ""}${picking !== undefined ? " ba-pickpile" : ""}`}
        data-pile={key}
        onClick={picking !== undefined ? (e) => { e.stopPropagation(); onPick?.(); } : undefined}
      >
        {picking !== undefined && picking > 0 && <span className="ba-pickcount">+{picking}</span>}
        <span className="ba-plabel">{label}</span>
        {label === "LIFE" && count > 0 ? (
          // Life: every card visible as a strip, a declared vertical stack
          // (constant LIFE_STEP, last on top) — countable at a glance
          <div className="ba-pcard ba-lifestack" data-stack="life" style={{ height: CARD_H + (count - 1) * LIFE_STEP }}>
            {Array.from({ length: count }).map((_, i) => {
              // a face-up Life card (M5) shows its art; the rest are backs
              const face = faces?.[i];
              return (
                <div key={i} className={`gb-card ba-card ba-lifecard${face ? " ba-lifeup" : " ba-backcard"}`} style={{ top: i * LIFE_STEP, zIndex: i + 1 }} title={face ? `${face.name} (face-up)` : undefined}>
                  {face
                    ? (face.image ? <img src={face.image} alt={face.name} /> : <span className="ba-lifeupname">{face.name}</span>)
                    : <span className="gb-back"><span className="gb-back-emblem" /></span>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ba-pcard">{children ?? (count > 0 ? <div className="gb-card ba-backcard"><span className="gb-back"><span className="gb-back-emblem" /></span></div> : <div className="ba-empty" />)}</div>
        )}
        <span className={`ba-pcount${tick ? " ba-tick" : ""}`}>{count}</span>
      </div>
    );
  }

  function Half({ pid, flip }: { pid: PID; flip: boolean }) {
    const p = game.players[pid];
    const trashTop = p.zones.trash[p.zones.trash.length - 1];
    const trashCard = trashTop ? cards.get(p.instances[trashTop].cardId) : undefined;
    const donActive = p.don.active;
    const donRested = p.don.rested;
    const isTurn = game.turnPlayer === pid;
    return (
      <div
        className={`ba-half${flip ? " flip" : ""}${isTurn ? " turn" : " idle"}${hitSeat === pid ? " ba-hit" : ""}${drag?.owner === pid ? " ba-dropok" : ""}`}
        data-half={pid}
        style={{ ["--lc" as string]: leaderHex(pid) }}
      >
        <div className="ba-sidecol">
          {PileBox({
            label: "LIFE", count: p.zones.life.length, pid, tick: hitSeat === pid,
            faces: p.zones.life.map((iid) => (p.instances[iid].faceUp ? cards.get(p.instances[iid].cardId) ?? null : null)),
          })}
          {PileBox({
            label: "DON!! DECK", count: p.don.deck, faceClass: "ba-donback", pid,
            picking: donChoice?.from === "deck" && pc?.player === pid ? donPick.length : undefined,
            onPick: () => pickDon(pid, "deck", 0),
          })}
        </div>
        <div className="ba-halfmain">
          {/* every table slot is as WIDE as a card is TALL: a rested (rotated)
              card stays inside its own slot, so nothing ever touches a neighbour */}
          <div className="ba-charrow">
            {p.zones.characterArea.map((iid) => (
              <div key={iid} className="ba-tslot">{BCard({ owner: pid, iid })}</div>
            ))}
            {Array.from({ length: Math.max(0, 5 - p.zones.characterArea.length) }).map((_, i) => (
              <div key={`slot${i}`} className="ba-tslot"><div className="ba-slot" /></div>
            ))}
          </div>
          <div className="ba-lsrow">
            <div className="ba-lsspacer" />
            <div className="ba-lscenter">
              <div className="ba-tslot">{BCard({ owner: pid, iid: p.leaderIid })}</div>
              <div className="ba-tslot">
                {p.zones.stage.length > 0 ? BCard({ owner: pid, iid: p.zones.stage[0] }) : <div className="ba-slot ba-stage">STAGE</div>}
              </div>
            </div>
            {/* COST AREA (OPTCGSim-style): two DECLARED ORDERED STACKS — active
                DON!! upright, rested DON!! rotated — each a compact cascade with
                a constant step (DON_STEP), the last card on top; the two groups
                are apart and the whole stack stays inside the row. */}
            <div className="ba-donrow" data-seat-don={pid}>
              <span className="ba-donlabel">COST AREA</span>
              {donActive > 0 && (
                <div className="ba-donstack active" data-stack="don-active" style={{ width: DON_W + (donActive - 1) * DON_STEP }}>
                  {Array.from({ length: donActive }).map((_, i) => {
                    const dialOn = (isTurn && mode.t === "don" && mode.picked.includes(i + 1))
                      || (pc?.kind === "payDon" && pc.player === pid && payPick.active.includes(i + 1))
                      || ((donChoice?.from === "active" || restSplit) && pc?.player === pid && donPick.includes(i + 1));
                    // raised one level per split at or before this DON!! (visual only)
                    const level = (donSplits[pid] ?? []).filter((s) => s > 0 && s <= i && s < donActive).length;
                    const groupStart = level > 0 && (donSplits[pid] ?? []).includes(i);
                    return (
                      <div
                        key={`a${i}`}
                        className={`gb-card ba-doncell${dialOn ? " ba-picked" : ""}${groupStart ? " ba-dongroup" : ""}${restSplit && restSplit.donMax > 0 && pc?.player === pid ? " ba-pickable" : ""}`}
                        style={{ left: i * DON_STEP, zIndex: i + 1, ...(level ? { transform: `translateY(${-level * DON_RAISE}px)` } : {}) }}
                        data-don-index={i + 1}
                        data-don-seat={pid}
                        data-don-level={level}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (longPressed.current) { longPressed.current = false; return; } // a long-press or a drag already acted
                          onDonTap(pid, i + 1);
                        }}
                        onPointerDown={(e) => { donPressStart(pid, i, e.pointerType); donDragStart(pid, i, e); }}
                        onPointerMove={donDragMove}
                        onPointerUp={(e) => { donPressEnd(); donDragEnd(e); }}
                        onPointerCancel={() => { donPressEnd(); donDragRef.current = null; setDonDrag(null); }}
                        onPointerLeave={() => { if (!donDragRef.current?.active) donPressEnd(); }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          splitDonAt(pid, i);
                        }}
                      >
                        <DonArt />
                      </div>
                    );
                  })}
                </div>
              )}
              {donRested > 0 && (
                <div className="ba-donstack rested" data-stack="don-rested" style={{ width: DON_H + (donRested - 1) * DON_STEP }}>
                  {Array.from({ length: donRested }).map((_, i) => (
                    // the rotated card's box is DON_H wide: offset the element so
                    // its rotated footprint starts exactly at i × step
                    <div
                      key={`r${i}`}
                      className={`gb-card ba-doncell gb-rested${(pc?.kind === "payDon" && pc.player === pid && payPick.rested.includes(i + 1)) || (donChoice?.from === "rested" && pc?.player === pid && donPick.includes(i + 1)) ? " ba-picked" : ""}${donChoice?.from === "rested" && pc?.player === pid ? " ba-pickable" : ""}`}
                      style={{ left: i * DON_STEP + (DON_H - DON_W) / 2, zIndex: i + 1 }}
                      data-don-rested={i + 1}
                      onClick={(e) => { e.stopPropagation(); if (!pickDon(pid, "rested", i + 1)) pickPayDon(pid, "rested", i + 1); }}
                    >
                      <DonArt />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="ba-sidecol">
          {PileBox({
            label: "TRASH",
            count: p.zones.trash.length,
            pid,
            children:
              trashTop && trashCard ? (
                <div
                  className="gb-card ba-backcard"
                  data-trash-top={trashTop}
                  onClick={(e) => {
                    e.stopPropagation();
                    inspect(trashCard.id);
                  }}
                >
                  <CardArt inst={{ instanceId: trashTop, cardId: trashCard.id, faceUp: true, rested: false }} card={trashCard} />
                </div>
              ) : undefined,
          })}
          {PileBox({ label: "DECK", count: p.zones.deck.length, pid })}
        </div>
      </div>
    );
  }

  function HandRow({ pid, small }: { pid: PID; small?: boolean }) {
    const p = game.players[pid];
    // side by side while they fit; beyond HAND_CAPACITY the hand becomes a
    // declared ordered stack (constant step, ≥25% of each card uncovered)
    const n = p.zones.hand.length;
    const cw = small ? TOP_HAND_W : CARD_W;
    const stacked = n > handCapacity(stage.field, cw);
    const step = stacked ? Math.max(Math.floor((handInner(stage.field) - cw) / (n - 1)), Math.ceil(cw * 0.25)) : 0;
    return (
      <div
        className={`ba-hand${small ? " small" : ""}${stacked ? " stacked" : ""}`}
        data-hand={pid}
        data-stack={stacked ? "hand" : undefined}
        style={stacked ? ({ ["--hstep" as string]: `${step}px` } as React.CSSProperties) : undefined}
      >
        {hiddenHand(pid)
          ? p.zones.hand.map((iid) => {
            // still face down, but an effect can target them ("trash 2 cards
            // from your opponent's hand"): pick blind, like at a real table
            const targetable = pc?.kind === "selectTargets" && pc.candidates.some((c) => c.iid === iid);
            return (
              <div
                key={iid}
                className={`gb-card ba-card ba-backcard${small ? " ba-small" : ""}${targetable ? " ba-target" : ""}${picked.includes(iid) ? " ba-picked" : ""}`}
                data-iid={iid}
                onClick={targetable ? (e) => { e.stopPropagation(); toggleTarget(iid); } : undefined}
              >
                <span className="gb-back"><span className="gb-back-emblem" /></span>
              </div>
            );
          })
          : p.zones.hand.map((iid) => BCard({ owner: pid, iid, small, inHand: true }))}
        {p.zones.hand.length === 0 && <span className="ba-donempty">EMPTY HAND</span>}
      </div>
    );
  }

  function SeatPanel({ pid }: { pid: PID }) {
    const p = game.players[pid];
    const active = lm.actor === pid && game.phase !== "over";
    const mm = Math.floor((clocks[pid] ?? 0) / 60);
    const ss = (clocks[pid] ?? 0) % 60;
    // DuelingBook layout, mirrored around the log: the top seat reads
    // life bar → avatar → stats, the bottom seat stats → avatar → life bar
    const top = pid === SEAT_B;
    const life = p.zones.life.length;
    const maxLife = Math.max(life, cards.get(p.instances[p.leaderIid].cardId)?.cost ?? 5, 1);
    const fill = life / maxLife;
    const av = avatarOf(pid);
    const lifeBar = (
      <div className="ba-lifebar" data-lifebar={pid}>
        <div className="ba-lifetrack">
          <div className="ba-lifefill" style={{ width: `${fill * 100}%`, backgroundSize: fill > 0 ? `${100 / fill}% 100%` : undefined }} />
          <span className="ba-lifelabel">LIFE</span>
          <b className="ba-lifenum">{life}</b>
        </div>
        {" " /* keeps "LIFE 5" and the clock apart in the panel's text */}
        <span className="ba-clock">{mm}:{String(ss).padStart(2, "0")}</span>
        {ConcedeButton({ pid })}
      </div>
    );
    const avatar = (
      <div className="ba-pfpbox" data-avatar={pid}>
        <b className="ba-pfpname">{seatName(pid)}</b>
        <div className="ba-pfpimg" style={{ background: av.color }}>
          {av.image
            ? <img src={av.image} alt="" draggable={false} />
            : <img className="moon" src="/assets/bg/avatar-moon.png" alt="" draggable={false} />}
        </div>
      </div>
    );
    return (
      <div className={`ba-seatpanel ${top ? "top" : "bottom"}${active ? " active" : ""}${game.turnPlayer === pid && game.phase !== "over" ? " turn" : ""}`}>
        {top ? lifeBar : null}
        {top ? avatar : null}
        <div className="ba-seatstats">
          <span>DECK <b>{p.zones.deck.length}</b></span>
          <span>HAND <b>{p.zones.hand.length}</b></span>
          <span>DON <b>{p.don.active}</b>/{p.don.rested}r</span>
        </div>
        {top ? null : avatar}
        {top ? null : lifeBar}
      </div>
    );
  }

  function ConcedeButton({ pid }: { pid: PID }) {
    if (game.phase === "over") return null;
    const arm = armConcede === pid;
    return (
          <button
            className={`ba-concede${arm ? " armed" : ""}`}
            data-act={`concede-${pid}`}
            title="Concede"
            aria-label="Concede"
            onClick={(e) => {
              e.stopPropagation();
              if (!arm) {
                setArmConcede(pid);
                setTimeout(() => setArmConcede((a) => (a === pid ? null : a)), 2500);
                return;
              }
              setArmConcede(null);
              dispatch({ type: "concede", player: pid });
            }}
          >
            {arm ? "Sure?" : "Concede"}
          </button>
    );
  }

  // ── log ─────────────────────────────────────────────────────────────────────
  const logRef = useRef<HTMLDivElement | null>(null);
  // ONE feed: duel log lines and table chat interleaved in time order (a chat
  // message sent after event N-1 shows right after that line)
  type FeedLine = { kind: string; text: string; cards?: { name: string; cardId: string }[] } | { seat: PID; text: string };
  const logLines = useMemo(() => {
    const out: FeedLine[] = [];
    let ci = 0;
    for (let i = 0; i <= events.length; i++) {
      while (ci < chat.length && chat[ci].at <= i) out.push(chat[ci++]);
      if (i < events.length) {
        const l = fmtEvent(events[i], game, cards, seatName);
        if (l) out.push(l);
      }
    }
    return out;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, game, chat],
  );
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines.length]);

  // ── overlays ────────────────────────────────────────────────────────────────

  const overlayCard = (cardId: string) => {
    const c = cards.get(cardId);
    return (
      <div className="ba-ovcard">
        {c?.image ? <img src={c.image} alt={c.name} /> : <span />}
      </div>
    );
  };

  let overlay: React.ReactNode = null;
  if (pc?.kind === "triggerDecision") {
    const c = cards.get(pc.cardId);
    overlay = (
      <div className="ba-overlay dock" data-dock>
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">{seatName(pc.player)} took a Life with [Trigger]</span>
          {overlayCard(pc.cardId)}
          <b className="ba-ovname">{c?.name ?? pc.cardId}</b>
          <p className="ba-ovtext">{c?.trigger ?? ""}</p>
          <div className="ba-ovbtns">
            <button className="ba-btn primary" data-act="trigger-activate" onClick={() => dispatch({ type: "respondTrigger", player: pc.player, activate: true })}>
              Activate [Trigger]
            </button>
            <button className="ba-btn" data-act="trigger-decline" onClick={() => dispatch({ type: "respondTrigger", player: pc.player, activate: false })}>
              Add to hand
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "mayActivate") {
    const c = cards.get(pc.sourceCardId);
    overlay = (
      <div className="ba-overlay dock" data-dock>
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">{seatName(pc.player)} — optional effect</span>
          {overlayCard(pc.sourceCardId)}
          <b className="ba-ovname">{c?.name ?? pc.sourceCardId}</b>
          <p className="ba-ovtext">{c?.effect ?? ""}</p>
          <div className="ba-ovbtns">
            <button className="ba-btn primary" data-act="may-yes" onClick={() => dispatch({ type: "respondMay", player: pc.player, activate: true })}>
              Activate
            </button>
            <button className="ba-btn" data-act="may-no" onClick={() => dispatch({ type: "respondMay", player: pc.player, activate: false })}>
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "manualResolve") {
    const cardId = findCardId(game, pc.sourceIid);
    const c = cardId ? cards.get(cardId) : undefined;
    overlay = (
      <div className="ba-overlay dock" data-dock>
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">Resolve manually — {seatName(pc.player)}</span>
          {cardId && overlayCard(cardId)}
          <b className="ba-ovname">{c?.name ?? cardId ?? ""}</b>
          <p className="ba-ovtext">{pc.text}</p>
          <p className="ba-ovnote">
            This effect isn't automated yet. Agree on its outcome at the table and continue — the activation is recorded in the log.
          </p>
          <div className="ba-ovbtns">
            <button className="ba-btn primary" data-act="manual-done" onClick={() => dispatch({ type: "ackManual", player: pc.player })}>
              Done — resolved
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "selectTargets" && pileCandidates) {
    // candidates living in a pile (trash / deck / Life) have no card on the
    // table to tap: show them all in a picker (QA bot: "return from trash")
    const max = Math.min(pc.count, pc.candidates.length);
    const ok = (pc.upTo ? picked.length <= max : picked.length === max) && setOk(pc, picked);
    overlay = (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov ba-peek">
          <span className="ba-ovtag">{seatName(pc.player)} — choose {pc.upTo ? `up to ${pc.count}` : max} ({pc.actionKind})</span>
          <div className="ba-peekgrid">
            {pc.candidates.map((c) => {
              const card = cards.get(game.players[c.owner].instances[c.iid].cardId);
              const on = picked.includes(c.iid);
              return (
                <div
                  key={c.iid}
                  className={`ba-peekcard eligible ba-target${on ? " taken ba-picked" : ""}`}
                  data-iid={c.iid}
                  onClick={(e) => { e.stopPropagation(); toggleTarget(c.iid); }}
                >
                  <div className="ba-peekart">{card?.image && <img src={card.image} alt={card.name} />}</div>
                  <b>{card?.name ?? c.iid}</b>
                  {on && <i className="ba-peektag">PICK</i>}
                </div>
              );
            })}
          </div>
          <div className="ba-ovbtns">
            <button className="ba-btn primary big" data-act="confirm-targets" disabled={!ok} onClick={() => dispatch({ type: "respondTargets", player: pc.player, iids: picked })}>
              {pc.upTo && picked.length === 0 ? "None" : `Confirm (${picked.length})`}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "peekSelect") {
    // M3 — look at the top N (8-4-4-4, 11-2-1). Step 1: take up to takeCount
    // among the eligible. Step 2 (when the rest goes back in any order): the
    // rest stays on screen in a row, dragged into order, then one button.
    const p = game.players[pc.player];
    const cardOf = (iid: Iid) => cards.get(p.instances[iid].cardId);
    const remaining = pc.cards.filter((iid) => !peekTake.includes(iid));
    const ordered = pc.rest === "topAnyOrder" || pc.rest === "bottomAnyOrder" || pc.rest === "topOrBottomAnyOrder";
    const sideOf = (iid: Iid): "top" | "bottom" => peekSide[iid] ?? (pc.rest === "bottomAnyOrder" ? "bottom" : "top");
    const modeLabel = pc.mode === "hand" ? "add to your hand" : pc.mode === "play" ? `play${pc.playRested ? " (rested)" : ""}` : pc.mode === "life" ? "add to the top of your Life" : pc.mode === "trash" ? "trash" : "look";
    const restLabel: Record<typeof pc.rest, string> = {
      topAnyOrder: "the rest goes back on top, in the order you choose",
      bottomAnyOrder: "the rest goes to the bottom, in the order you choose",
      topOrBottomAnyOrder: "the rest goes on top or at the bottom, in the order you choose",
      shuffle: "the rest is shuffled back into the deck",
      trash: "the rest is trashed",
    };
    // the row, left to right = higher to lower in the deck
    const row = peekOrder.length === remaining.length && remaining.every((iid) => peekOrder.includes(iid)) ? peekOrder : remaining;
    const send = (order: Iid[]) => dispatch({
      type: "respondPeek", player: pc.player, take: peekTake,
      restTop: order.filter((iid) => pc.rest === "topAnyOrder" || (pc.rest === "topOrBottomAnyOrder" && sideOf(iid) === "top")),
      restBottom: order.filter((iid) => pc.rest === "bottomAnyOrder" || (pc.rest === "topOrBottomAnyOrder" && sideOf(iid) === "bottom")),
    });
    const afterTake = () => {
      if (ordered && remaining.length > 1) {
        setPeekOrder(remaining);
        setPeekArranging(true);
      } else send(remaining);
    };
    /** Drag in the row: the card follows the pointer to the slot it is over. */
    const moveTo = (x: number, y: number) => {
      const dragged = peekDragRef.current;
      const over = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-arrange-iid]")?.dataset.arrangeIid;
      if (!dragged || !over || over === dragged) return;
      const next = row.filter((iid) => iid !== dragged);
      next.splice(row.indexOf(over), 0, dragged);
      setPeekOrder(next);
    };
    const doneLabel = pc.rest === "bottomAnyOrder" ? "Put on bottom" : pc.rest === "topAnyOrder" ? "Put on top" : "Put back";
    overlay = peekArranging ? (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov ba-peek">
          <span className="ba-ovtag">{seatName(pc.player)} — {pc.rest === "bottomAnyOrder" ? "to the bottom of the deck" : pc.rest === "topAnyOrder" ? "back on top of the deck" : "top or bottom of the deck"}</span>
          <p className="ba-ovtext">Drag the cards to change their order. <b>Left = higher in the deck</b>, right = lower.</p>
          <div className="ba-peekgrid ba-arrange" data-arrange>
            {row.map((iid, i) => {
              const c = cardOf(iid);
              return (
                <div
                  key={iid}
                  className={`ba-peekcard eligible${peekDragRef.current === iid ? " dragging" : ""}`}
                  data-arrange-iid={iid}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    peekDragRef.current = iid;
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
                  }}
                  onPointerMove={(e) => { if (peekDragRef.current === iid) moveTo(e.clientX, e.clientY); }}
                  onPointerUp={() => { peekDragRef.current = null; setPeekOrder((o) => [...o]); }}
                  onPointerCancel={() => { peekDragRef.current = null; }}
                >
                  <span className="ba-peekpos">{i + 1}</span>
                  <div className="ba-peekart">{c?.image && <img src={c.image} alt={c.name} draggable={false} />}</div>
                  <b>{c?.name ?? iid}</b>
                  {pc.rest === "topOrBottomAnyOrder" && (
                    <button
                      className="ba-btn tiny"
                      data-act="peek-side"
                      data-peek-iid={iid}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setPeekSide((prev) => ({ ...prev, [iid]: sideOf(iid) === "top" ? "bottom" : "top" }))}
                    >
                      {sideOf(iid) === "top" ? "Top" : "Bottom"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ba-ovbtns">
            <button className="ba-btn" data-act="peek-back" onClick={() => setPeekArranging(false)}>← Back</button>
            <button className="ba-btn primary big" data-act="peek-confirm" onClick={() => send(row)}>{doneLabel}</button>
          </div>
        </div>
      </div>
    ) : (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov ba-peek">
          <span className="ba-ovtag">{seatName(pc.player)} — look at the top {pc.cards.length}</span>
          <p className="ba-ovtext">
            Tap up to <b>{pc.takeCount}</b> highlighted card{pc.takeCount === 1 ? "" : "s"} to {modeLabel}
            {pc.eligible.length === 0 ? " (nothing matches)" : ""}. Then: {restLabel[pc.rest]}.
          </p>
          <div className="ba-peekgrid">
            {pc.cards.map((iid, i) => {
              const c = cardOf(iid);
              const eligible = pc.eligible.includes(iid);
              const taken = peekTake.includes(iid);
              return (
                <div
                  key={iid}
                  className={`ba-peekcard${eligible ? " eligible" : " dim"}${taken ? " taken" : ""}`}
                  data-peek-iid={iid}
                  onClick={() => {
                    if (!eligible) return;
                    setPeekTake((prev) =>
                      prev.includes(iid) ? prev.filter((x) => x !== iid)
                        : prev.length >= pc.takeCount ? prev : [...prev, iid]);
                  }}
                >
                  <span className="ba-peekpos">#{i + 1}</span>
                  <div className="ba-peekart">{c?.image && <img src={c.image} alt={c.name} />}</div>
                  <b>{c?.name ?? iid}</b>
                  {taken && <i className="ba-peektag">{pc.mode === "play" ? "PLAY" : pc.mode === "life" ? "LIFE" : "TAKE"}</i>}
                </div>
              );
            })}
          </div>
          <div className="ba-ovbtns">
            <button className="ba-btn primary big" data-act="peek-confirm" onClick={afterTake}>
              {peekTake.length ? `Take ${peekTake.length}` : "Take none"}{ordered && remaining.length > 1 ? " →" : ""}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "mayReplace") {
    // M5 — "you may … instead" (8-1-3-4)
    const src = cards.get(findCardId(game, pc.sourceIid) ?? "");
    const target = cards.get(findCardId(game, pc.targetIid) ?? "");
    overlay = (
      <div className="ba-overlay dock" data-dock>
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">{seatName(pc.player)} — replace?</span>
          {src && <b className="ba-ovname">{src.name}</b>}
          <p className="ba-ovtext">
            {target?.name ?? "Your card"} would be {pc.battle ? "K.O.'d" : "removed"}. Use this effect instead?
          </p>
          {src?.effect && <p className="ba-ovtext ba-ovsmall">{src.effect}</p>}
          <div className="ba-ovbtns">
            <button className="ba-btn" data-act="replace-no" onClick={() => dispatch({ type: "respondReplace", player: pc.player, use: false })}>No</button>
            <button className="ba-btn primary big" data-act="replace-yes" onClick={() => dispatch({ type: "respondReplace", player: pc.player, use: true })}>Yes, instead</button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "arrangeLife") {
    // M5 — "look at all of your Life cards [; place N at the top of your deck]
    // and place them back in any order": tap = to the deck, "order" = new position
    const p = game.players[pc.lifeOwner];
    const cardOf = (iid: Iid) => cards.get(p.instances[iid].cardId);
    const remaining = pc.cards.filter((iid) => !peekTake.includes(iid));
    const idx = (iid: Iid) => { const i = peekOrder.indexOf(iid); return i === -1 ? 999 + pc.cards.indexOf(iid) : i; };
    const order = [...remaining].sort((a, b) => idx(a) - idx(b));
    overlay = (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov ba-peek">
          <span className="ba-ovtag">{seatName(pc.player)} — {pc.lifeOwner === pc.player ? "your" : "the opponent's"} Life cards (#1 = top)</span>
          <p className="ba-ovtext">
            {pc.toDeckTop > 0 ? <>Tap <b>{pc.toDeckTop}</b> card{pc.toDeckTop === 1 ? "" : "s"} to place at the top of the deck. </> : null}
            Use "order" to set the new Life order (1 = top); unordered cards keep their place after the ordered ones.
          </p>
          <div className="ba-peekgrid">
            {pc.cards.map((iid, i) => {
              const c = cardOf(iid);
              const taken = peekTake.includes(iid);
              const pos = peekOrder.indexOf(iid);
              return (
                <div
                  key={iid}
                  className={`ba-peekcard${pc.toDeckTop > 0 ? " eligible" : ""}${taken ? " taken" : ""}`}
                  data-peek-iid={iid}
                  onClick={() => {
                    if (pc.toDeckTop === 0) return;
                    setPeekTake((prev) => (prev.includes(iid) ? prev.filter((x) => x !== iid) : prev.length >= pc.toDeckTop ? prev : [...prev, iid]));
                    setPeekOrder((prev) => prev.filter((x) => x !== iid));
                  }}
                >
                  <span className="ba-peekpos">#{i + 1}</span>
                  <div className="ba-peekart">{c?.image && <img src={c.image} alt={c.name} />}</div>
                  <b>{c?.name ?? iid}</b>
                  {taken && <i className="ba-peektag">DECK</i>}
                  {!taken && (
                    <span className="ba-peekorder" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`ba-btn tiny${pos >= 0 ? " on" : ""}`}
                        data-act="life-order"
                        data-peek-iid={iid}
                        onClick={() => setPeekOrder((prev) => (prev.includes(iid) ? prev.filter((x) => x !== iid) : [...prev, iid]))}
                      >
                        {pos >= 0 ? `${pos + 1}` : "order"}
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ba-ovbtns">
            {peekOrder.length > 0 && <button className="ba-btn" data-act="life-reset" onClick={() => setPeekOrder([])}>Reset order</button>}
            <button
              className="ba-btn primary big"
              data-act="life-confirm"
              disabled={peekTake.length !== pc.toDeckTop}
              onClick={() => dispatch({ type: "respondArrangeLife", player: pc.player, order, toDeck: peekTake })}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "chooseOption") {
    // M5 — "Choose one:" / "X or Y:" cost: one button per option
    const src = cards.get(findCardId(game, pc.sourceIid) ?? "");
    overlay = (
      <div className="ba-overlay dock" data-dock>
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">{seatName(pc.player)} — {pc.purpose === "cost" ? "choose how to pay" : "choose one"}</span>
          {src && <b className="ba-ovname">{src.name}</b>}
          <div className="ba-ovbtns ba-options">
            {pc.options.map((label, index) => (
              <button
                key={index}
                className="ba-btn big"
                data-act={`option-${index}`}
                disabled={!pc.enabled[index]}
                onClick={() => dispatch({ type: "respondOption", player: pc.player, index })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "chooseNumber") {
    // M3 — "draw up to N" (8-4-4-1: 'up to' allows 0)
    const src = cards.get(findCardId(game, pc.sourceIid) ?? "");
    const value = numberPick ?? pc.max;
    overlay = (
      <div className="ba-overlay dock" data-dock>
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">{seatName(pc.player)} — {pc.purpose === "draw" ? `draw up to ${pc.max}` : pc.purpose === "life" ? `add up to ${pc.max} to Life` : pc.purpose === "declare" ? "choose a cost" : pc.purpose === "addDon" ? `add up to ${pc.max} DON!!` : pc.purpose === "standDon" ? `set up to ${pc.max} DON!! as active` : pc.purpose === "restDon" ? `rest up to ${pc.max} DON!!` : "choose a number"}</span>
          {src && <b className="ba-ovname">{src.name}</b>}
          <p className="ba-ovtext">{pc.purpose === "life" ? "How many cards from the top of the deck go to the top of the Life?" : pc.purpose === "declare" ? "Which cost? The top card of your opponent's deck is revealed next."
            : pc.purpose === "addDon" ? "How many DON!! cards come from your DON!! deck?" : pc.purpose === "standDon" ? "How many of your rested DON!! cards become active?" : pc.purpose === "restDon" ? "How many of your DON!! cards do you rest?" : "How many cards do you draw?"}</p>
          <div className="ba-numbers">
            {Array.from({ length: pc.max - pc.min + 1 }, (_, i) => pc.min + i).map((v) => (
              <button
                key={v}
                className={`ba-btn${value === v ? " primary" : ""}`}
                data-act={`number-${v}`}
                onClick={() => setNumberPick(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="ba-ovbtns">
            <button className="ba-btn primary big" data-act="number-confirm" onClick={() => dispatch({ type: "respondNumber", player: pc.player, value })}>
              Confirm ({value})
            </button>
          </div>
        </div>
      </div>
    );
  } else if (game.phase === "over") {
    overlay = (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">GAME OVER</span>
          <b className="ba-ovname big">{game.winner ? seatName(game.winner) : "?"} WINS</b>
          <p className="ba-ovtext">{WIN_REASON[game.winReason ?? ""] ?? game.winReason}</p>
          <div className="ba-ovbtns">
            <button className="ba-btn primary" data-act="rematch" onClick={rematch}>Rematch</button>
            <button className="ba-btn" data-act="newdecks" onClick={reset}>Change decks</button>
            <button className="ba-btn" data-act="gohome" onClick={() => setView("home")}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  // the AI answers its own prompts: no panels for a seat nobody here plays
  if (aiActing) overlay = null;
  // DON!!-moving effects are answered on the table (the band explains)
  if (donChoice || restSplit) overlay = null;
  // a take-back request waits for the opponent before anything else
  if (undoRequest) {
    const entry = [...history].reverse().find((h) => h.actor === undoRequest.by);
    const what = entry ? events.slice(entry.eventsLen).map((e) => fmtEvent(e, game, cards, seatName)).find(Boolean)?.text : null;
    const opponent = seats.find((s) => s.pid !== undoRequest.by)!;
    overlay = (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov" data-undo-request>
          <span className="ba-ovtag">TAKE-BACK</span>
          <b className="ba-ovname">{seatName(undoRequest.by)} asks to take back their last move</b>
          {what && <p className="ba-ovtext">“{what}”</p>}
          <p className="ba-ovtext"><b>{opponent.name}</b>, do you accept? Everything after that move is undone too.</p>
          <div className="ba-ovbtns">
            <button className="ba-btn primary big" data-act="undo-accept" onClick={() => answerUndo(true)}>Accept</button>
            <button className="ba-btn big" data-act="undo-decline" onClick={() => answerUndo(false)}>Decline</button>
          </div>
        </div>
      </div>
    );
  }

  const battleStep = game.battle ? game.battle.step : null;
  const phaseLabel =
    game.phase === "setup" ? "SETUP" : game.phase === "over" ? "GAME OVER" : battleStep ? `${battleStep.toUpperCase()} STEP` : "MAIN PHASE";

  // preview rail content
  // nothing inspected yet → the turn player's Leader (never an empty rail)
  const turnLeader = game.players[game.turnPlayer] ? cards.get(game.players[game.turnPlayer].instances[game.players[game.turnPlayer].leaderIid]?.cardId ?? "") : undefined;
  const shown = preview ?? turnLeader ?? null;
  const previewPanel = shown ? (
    <>
      {/* the card itself, as big as the rail allows: the printed text is the
          text (no transcription under it). Only the automation disclosure stays. */}
      <div className="ba-prevart" key={shown.id}>
        {shown.image
          ? <img src={shown.image} alt={`${shown.name} — ${shown.effect ?? ""}`} />
          : <div className="ba-prevfx">{shown.name}{"\n\n"}{shown.effect}</div>}
      </div>
      {automationInfo(shown).note && <div className="ba-prevnote">{automationInfo(shown).note}</div>}
    </>
  ) : (
    <div className="ba-prevempty">Tap or hover a card to inspect it.</div>
  );

  const endTurnButton = (
    <button
      className="ba-btn primary big ba-endturn"
      data-act="endturn"
      disabled={!lm.canEndTurn || aiActing}
      title={`${seatName(game.turnPlayer)}'s turn — end it (E)`}
      style={{ ["--lc" as string]: leaderHex(game.turnPlayer) }}
      onClick={() => dispatch({ type: "endTurn", player: game.turnPlayer })}
    >
      End turn
    </button>
  );

  return (
    <div className="ba-stagewrap" data-stage-scale={stage.scale.toFixed(4)} data-stage-rotate={stage.rotate ? "1" : "0"}>
    {/* the living night-sea pixel scene behind the table (same real layers as
        the Home hero), at viewport size OUTSIDE the scaled stage */}
    <div className={`ba-scene${stage.rotate ? " rot" : ""}`}><NightSea /></div>
    <div
      className="ba-root ba-game ba-stage"
      style={{ transform: stageTransform(stage), width: stage.w, gridTemplateColumns: `${stage.rail}px ${stage.field}px ${stage.rail}px`, ["--rail" as string]: `${stage.rail}px` }}
      onClick={() => { if (mode.t !== "idle") setMode({ t: "idle" }); }}
    >
      <Banner />

      <div className="ba-left">
        {/* turn toast sits IN the rail flow (never over the table or rail) */}
        {toast && <div className="ba-toast">{toast}</div>}
        <div className="ba-preview">{previewPanel}</div>
        {hasAi && (
          <div className="ba-aictl" data-ai-controls>
            <span className="ba-aictl-tag">AI · Pro</span>
            <div className="ba-aictl-row">
              <button className="ba-btn" data-act="ai-pause" onClick={() => setAiPaused(!aiPaused)}>{aiPaused ? "▶ Play" : "❚❚ Pause"}</button>
              <button className="ba-btn" data-act="ai-step" disabled={!aiPaused || !aiActing} onClick={aiStep}>{aiPlan ? "Play it" : "Think"}</button>
            </div>
            {/* coach mode: what the AI is about to do, and what else it weighed */}
            {aiPlan && (
              <div className="ba-aiplan" data-ai-plan>
                <div className="ba-aiplan-next">{seats.find((x) => x.pid === aiPlan.pid)?.name}: <b>{aiPlan.text}</b></div>
                {aiPlan.candidates.length > 1 && (
                  <ol className="ba-aiplan-list">
                    {aiPlan.candidates.map((c, i) => (
                      <li key={i} className={i === 0 ? "chosen" : ""}>
                        <span>{c.text}</span>
                        <span className="ba-aiplan-score">{c.mean} · {c.rollouts}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            <div className="ba-aictl-row">
              {AI_SPEEDS.map((sp) => (
                <button key={sp.ms} className={`ba-btn${aiDelay === sp.ms ? " primary" : ""}`} data-act={`ai-speed-${sp.label.toLowerCase()}`} onClick={() => setAiDelay(sp.ms)}>{sp.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="ba-railfill" />
        {/* the night sea behind the table is OGA-BY 3.0: credited on screen */}
        <span className="ba-credit">Night sky: <a href="https://opengameart.org/content/moon-and-sea-pixel-art-background" target="_blank" rel="noopener noreferrer">“Moon and Sea”</a> by CraftPix.net (OGA-BY 3.0)</span>
        <button
          className={`ba-btn${confirmPicks ? " primary" : ""}`}
          data-act="confirm-picks"
          title={confirmPicks ? "Every choice waits for a Confirm" : "Complete choices resolve at once; nothing-to-do windows are skipped"}
          onClick={() => setConfirmPicks(!confirmPicks)}
        >
          Confirm every choice: {confirmPicks ? "on" : "off"}
        </button>
        <button
          className="ba-btn ba-undo"
          data-act="undo"
          disabled={!lastHumanMove || !!undoRequest}
          title={lastHumanMove ? `Ask to take back ${seatName(lastHumanMove.actor)}'s last move` : "No move to take back yet"}
          onClick={requestUndo}
        >
          ↶ Take back last move
        </button>
        <button className="ba-btn ghost" data-act="exit" onClick={() => setView("home")}>Exit to Home</button>
      </div>

      <div className="ba-centercol">
        {HandRow({ pid: SEAT_B, small: true })}
        <div className="ba-field" ref={fieldRef}>
          {Half({ pid: SEAT_B, flip: true })}
          {/* the band between the halves: turn/phase at the left, End turn at
              the right edge (where the hand rests at a real table) */}
          <div className="ba-band">
            <div className="ba-turnbox">
              <span className="ba-turnpill">TURN <b>{Math.max(1, game.turn)}</b></span>
              <span className="ba-phasepill">{phaseLabel}</span>
            </div>
            {/* reserved slot: prompts overlay here, the table never reflows */}
            <div className="ba-promptslot">
              {aiActing ? <div className="ba-aithinking" data-ai-thinking>{seatName(lm.actor)} {aiPaused ? "— paused" : "is thinking…"}</div> : actionBar}
            </div>
            {endTurnButton}
          </div>
          {Half({ pid: SEAT_A, flip: false })}
          {/* always mounted: its screen CTM is the field's coordinate oracle */}
          <svg className="ba-arrow" aria-hidden ref={svgRef}>
            {arrow && (
              <>
                <defs>
                  <marker id="ba-arrowhead" markerWidth="8" markerHeight="8" refX="6.2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M0,0 L8,4 L0,8 Z" fill={arrow.color} />
                  </marker>
                </defs>
                {/* solid, uniform stroke in the attacker leader's color (block
                    redirects just move the end point — same style) */}
                <path
                  d={`M${arrow.x1},${arrow.y1} Q${(arrow.x1 + arrow.x2) / 2 + 40},${(arrow.y1 + arrow.y2) / 2} ${arrow.x2},${arrow.y2}`}
                  fill="none"
                  stroke={arrow.color}
                  strokeWidth="4"
                  strokeLinecap="round"
                  markerEnd="url(#ba-arrowhead)"
                />
              </>
            )}
          </svg>
          {BattleHud()}
          {fxList.map((f) => (
            <div
              key={f.id}
              className={`ba-fx ${f.kind}`}
              style={{
                left: f.x, top: f.y, width: f.w, height: f.h,
                ["--dx" as string]: `${f.dx}px`, ["--dy" as string]: `${f.dy}px`,
                ["--tx" as string]: `${f.tx ?? 0}px`, ["--ty" as string]: `${f.ty ?? 0}px`,
                ...(f.color ? { ["--lc" as string]: f.color } : {}),
              }}
              onAnimationEnd={(ev) => { if (ev.target === ev.currentTarget) setFxList((l) => l.filter((x) => x.id !== f.id)); }}
            >
              {f.kind === "counter" ? (
                <>
                  {f.cardId && cards.get(f.cardId)?.image && <img src={cards.get(f.cardId)!.image} alt="" />}
                  <span className="ba-fx-amount">{f.label}</span>
                </>
              ) : f.kind === "reveal" ? (
                <div className={`ba-fx-flip${f.flip ? " flip" : ""}`}>
                  <div className="ba-fx-face">{f.cardId && cards.get(f.cardId)?.image && <img src={cards.get(f.cardId)!.image} alt="" />}</div>
                  <div className="ba-fx-face back"><span className="gb-back"><span className="gb-back-emblem" /></span></div>
                </div>
              ) : f.kind === "don" ? (
                <DonArt />
              ) : (f.kind === "ko" || f.kind === "cast") && f.cardId && cards.get(f.cardId)?.image
                ? <img src={cards.get(f.cardId)!.image} alt="" />
                : <span className="gb-back"><span className="gb-back-emblem" /></span>}
            </div>
          ))}
        </div>
        {HandRow({ pid: SEAT_A })}
      </div>

      <div className="ba-right">
        {SeatPanel({ pid: SEAT_B })}
        {/* ONE box: duel log + table chat, typed at the bottom (DuelingBook) */}
        <div className="ba-log" data-chat>
          <div className="ba-log-scroll" ref={logRef}>
            {logLines.map((l, i) =>
              "seat" in l
                ? <p key={i} className="ba-chatline"><b className={l.seat === SEAT_B ? "b" : ""}>{seatName(l.seat)}:</b> {l.text}</p>
                : <p key={i} className={`ba-logline ${l.kind}`}>{withCardNames(l.text, l.cards)}</p>,
            )}
          </div>
          <form
            className="ba-chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              const text = chatDraft.trim();
              if (!text) return;
              setChat((c) => [...c, { seat: chatSeat, text, at: events.length }]);
              setChatDraft("");
            }}
          >
            <button type="button" className="ba-chat-seat" title="Who is typing" onClick={() => setChatSeat(chatSeat === SEAT_A ? SEAT_B : SEAT_A)}>
              {seatName(chatSeat).slice(0, 10)}
            </button>
            <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Say something…" maxLength={200} data-chat-input />
            <button type="submit" data-act="chat-send" disabled={!chatDraft.trim()}>Send</button>
          </form>
        </div>
        {SeatPanel({ pid: SEAT_A })}
      </div>

      {overlay}
    </div>
    {/* drag-to-play ghost: viewport coordinates, card size at the stage scale */}
    {/* DON!! group drag ghost: the group as a small cascade + its count */}
    {donDrag && (
      <div
        className={`ba-dondrag${stage.rotate ? " rot" : ""}`}
        style={{ left: donDrag.x, top: donDrag.y, width: (DON_W + (donDrag.count - 1) * DON_STEP) * stage.scale, height: DON_H * stage.scale }}
      >
        {Array.from({ length: donDrag.count }).map((_, i) => (
          <div key={i} className="gb-card" style={{ left: i * DON_STEP * stage.scale, width: DON_W * stage.scale, height: DON_H * stage.scale, zIndex: i + 1 }}>
            <DonArt />
          </div>
        ))}
        <span className="ba-dondrag-count">×{donDrag.count}</span>
      </div>
    )}
    {/* drag-to-play ghost: viewport coordinates, card size at the stage scale;
        it lives outside the stage, so in portrait it needs the stage's 90° turn */}
    {drag && cards.get(drag.cardId)?.image && (
      <img
        className={`ba-dragghost${stage.rotate ? " rot" : ""}`}
        src={cards.get(drag.cardId)!.image}
        alt=""
        style={{ left: drag.x, top: drag.y, width: CARD_W * stage.scale * 1.08 }}
      />
    )}
    </div>
  );
}
