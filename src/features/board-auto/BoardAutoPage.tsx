import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CardArt, DonArt } from "../board/BoardPage";
import { cardColorHex, type Card } from "../cards/cardsDb";
import { api } from "../../lib/api";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import { legalMoves } from "../../autosim/engine/legality";
import { effectivePower, keywordsOf, type AutoGameState, type Iid, type PID } from "../../autosim/engine/state";
import type { Keyword } from "../../autosim/ir/types";
import { getCardDb, getCardsById, useAutoStore, type SeatSetup } from "./autoStore";
import { automationInfo } from "./compile";
import { buildDemoDecks, userDeckChoices, type DeckChoice } from "./decks";
import { fmtEvent } from "./log";
import "./boardauto.css";

/* =============================================================================
   BOARD AUTO — the AUTOSIM full-rules board (AUTOSIM_PLAN.md §7).
   Presentation only: every move is a PlayerIntent through autoStore.dispatch;
   affordances come exclusively from legality.ts / the pending ChoiceRequest.
   Hotseat: seat A plays the bottom half, seat B the top one (NOT rotated —
   both players sit on the same side of one screen, readability wins).
   ========================================================================== */

const SEAT_A: PID = "seatA";
const SEAT_B: PID = "seatB";

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
const STAGE_W = 1600;
const STAGE_H = 900;

interface StageFit { scale: number; rotate: boolean; ox: number; oy: number }

function fitStage(vw: number, vh: number): StageFit {
  const rotate = vh > vw; // portrait → the stage lies on its side
  const w = rotate ? STAGE_H : STAGE_W; // device-space footprint
  const h = rotate ? STAGE_W : STAGE_H;
  const scale = Math.min(vw / w, vh / h);
  return { scale, rotate, ox: (vw - w * scale) / 2, oy: (vh - h * scale) / 2 };
}

function useStageFit(): StageFit {
  const [fit, setFit] = useState<StageFit>(() =>
    typeof window !== "undefined" ? fitStage(window.innerWidth, window.innerHeight) : { scale: 1, rotate: false, ox: 0, oy: 0 });
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
  useEffect(() => {
    let alive = true;
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

  const [names, setNames] = useState<[string, string]>([user?.username ?? "Player 1", "Player 2"]);
  const [sel, setSel] = useState<[DeckChoice | null, DeckChoice | null]>([null, null]);
  const options = [...demoDecks, ...mine];

  const seatCol = (idx: 0 | 1) => (
    <div className="ba-seatcol">
      <div className="ba-seathead">
        <span className="ba-seattag">{idx === 0 ? "SEAT A — bottom" : "SEAT B — top"}</span>
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
      <Banner />
      <header className="ba-setuphead">
        <button className="ba-btn" data-act="home" onClick={() => setView("home")}>← Home</button>
        <h1>PLAY AUTO — FULL RULES</h1>
        <span className="ba-sub">Hotseat · every rule enforced by the AUTOSIM engine</span>
      </header>
      <div className="ba-pickgrid">
        {seatCol(0)}
        {seatCol(1)}
      </div>
      <footer className="ba-setupfoot">
        <button
          className="ba-btn primary big"
          data-act="start"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            tryEnterLandscape(); // user gesture: the table is landscape-first
            const seats: [SeatSetup, SeatSetup] = [
              { pid: SEAT_A, name: names[0].trim(), deck: sel[0]! },
              { pid: SEAT_B, name: names[1].trim(), deck: sel[1]! },
            ];
            confirmSeats(seats);
          }}
        >
          To the starting roll →
        </button>
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
  const cards = getCardsById()!;
  const lm = useMemo(() => legalMoves(db, game), [db, game]);
  const pc = game.pendingChoice;

  const seatName = (pid: PID) => seats.find((s) => s.pid === pid)?.name ?? pid;
  const leaderHex = (pid: PID) => {
    const leaderCard = cards.get(game.players[pid].instances[game.players[pid].leaderIid].cardId);
    return leaderCard ? cardColorHex(leaderCard) : "#3a4a5e";
  };

  const [preview, setPreview] = useState<Card | null>(null);
  const [mode, setMode] = useState<Mode>({ t: "idle" });
  const [picked, setPicked] = useState<Iid[]>([]);
  const [armConcede, setArmConcede] = useState<PID | null>(null);
  // fixed-resolution stage, scaled (and rotated in portrait) to the viewport
  const stage = useStageFit();
  // while at the table: no page rubber-banding; leaving it (home, change
  // decks, rematch) releases the orientation lock
  useEffect(() => {
    const prev = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overscrollBehavior = prev;
      leaveLandscape();
    };
  }, []);
  /** Hand card selected by a tap: shows the in-place PLAY button (if legal);
   *  a second tap deselects. */
  const [selectedHand, setSelectedHand] = useState<Iid | null>(null);
  // M3 windows: local drafts of the answer being composed
  const [peekTake, setPeekTake] = useState<Iid[]>([]);
  const [peekOrder, setPeekOrder] = useState<Iid[]>([]);
  const [peekSide, setPeekSide] = useState<Record<Iid, "top" | "bottom">>({});
  const [payPlan, setPayPlan] = useState<{ fromActive: number; fromRested: number; fromGiven: Record<Iid, number> }>({
    fromActive: 0, fromRested: 0, fromGiven: {},
  });
  const [numberPick, setNumberPick] = useState<number | null>(null);
  // DON placeholders: PURELY VISUAL, per-seat marked active-DON indexes.
  // Never an intent — the engine's DON state is untouched (plan §1 rule).
  const [donMarks, setDonMarks] = useState<Record<PID, number[]>>({});
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
    setPayPlan({ fromActive: 0, fromRested: 0, fromGiven: {} });
    setNumberPick(null);
  }, [pc, game.turn, game.battle?.step, game.phase]);

  // DON placeholders reset at every turn change (they are thinking aids)
  useEffect(() => {
    setDonMarks({});
  }, [game.turn]);

  // compact: a selected hand card that left the hand (played / discarded /
  // turn passed) is deselected
  useEffect(() => {
    if (!selectedHand) return;
    const inHand = Object.values(game.players).some((p) => p.zones.hand.includes(selectedHand));
    if (!inHand || game.pendingChoice) setSelectedHand(null);
  }, [game, selectedHand]);

  // touch: long-press on an active DON toggles the placeholder (no right-click)
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const donPressStart = (pid: PID, index: number, pointerType: string) => {
    if (pointerType !== "touch") return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      toggleDonMark(pid, index);
    }, 480);
  };
  const donPressEnd = () => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const toggleDonMark = (pid: PID, index: number) => {
    setDonMarks((prev) => {
      const cur = prev[pid] ?? [];
      return { ...prev, [pid]: cur.includes(index) ? cur.filter((x) => x !== index) : [...cur, index] };
    });
    if (!donHintShown.current) {
      donHintShown.current = true;
      explain(
        "DON!! placeholder — visual only, the game state does not change.",
        "Right-click (long-press on touch) toggles it off; all marks clear at the turn change.",
        "info",
      );
    }
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
  }, [game.battle?.attackerIid, game.battle?.targetIid, mode, hoverTarget, events.length]);

  // ── functional micro-animations: Life taken / Character K.O.'d ──────────────
  // transform+opacity only, ≤250ms, skipped under prefers-reduced-motion
  interface Fx { id: number; kind: "life" | "ko"; x: number; y: number; w: number; h: number; dx: number; dy: number; cardId?: string }
  const [fxList, setFxList] = useState<Fx[]>([]);
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
          fly("life", pileFrom(`[data-pile="life-${e.player}"] .ba-pcard`),
            document.querySelector(e.type === "lifeCardToHand" ? `[data-hand="${e.player}"]` : `[data-pile="trash-${e.player}"] .ba-pcard`));
        }
      } else if (e.type === "characterKOd" && !reduce) {
        fly("ko", lastRects.current.get(e.iid) ?? null, document.querySelector(`[data-pile="trash-${e.player}"] .ba-pcard`),
          game.players[e.player]?.instances[e.iid]?.cardId);
      }
    }
    if (added.length) {
      setFxList((l) => [...l, ...added]);
      const ids = added.map((f) => f.id);
      window.setTimeout(() => setFxList((l) => l.filter((f) => !ids.includes(f.id))), 700); // safety net
    }
    if (hit) {
      setHitSeat(hit);
      window.setTimeout(() => setHitSeat(null), 360);
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
    setPicked((prev) => {
      if (prev.includes(iid)) return prev.filter((x) => x !== iid);
      const max = Math.min(pc.count, pc.candidates.length);
      return prev.length >= max ? prev : [...prev, iid];
    });
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

  const onHandTap = (owner: PID, iid: Iid) => {
    const inst = game.players[owner].instances[iid];
    hover(inst.cardId);
    if (pc?.kind === "selectTargets") {
      toggleTarget(iid);
      return;
    }
    if (pc?.kind === "counterWindow" && pc.player === owner) {
      const cc = lm.counterCards.find((c) => c.iid === iid);
      if (cc && game.battle) {
        dispatch({ type: "useCounter", player: owner, cardIid: iid, targetIid: game.battle.targetIid });
        return;
      }
      const ce = lm.counterEvents.find((c) => c.iid === iid);
      if (ce) {
        dispatch({ type: "useCounterEvent", player: owner, cardIid: iid });
        return;
      }
      explain("This card can't counter.", "Usable now: cards with a counter value, or [Counter] Events you can pay.");
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
    if (pc?.kind === "selectTargets") {
      toggleTarget(iid);
      return;
    }
    if (pc?.kind === "blockWindow" && pc.player === owner && pc.blockers.includes(iid)) {
      dispatch({ type: "respondBlock", player: owner, blockerIid: iid });
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
      if (mode.t === "attack") {
        setMode({ t: "idle" });
        return;
      }
      const inst = game.players[owner].instances[iid];
      const p = game.players[owner];
      const isBoard = iid === p.leaderIid || p.zones.characterArea.includes(iid) || p.zones.stage.includes(iid);
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
    if (mode.t === "attack") { setMode({ t: "idle" }); return; }
    inspect(cardId, { owner, iid });
  };

  /** [Activate: Main] (10-2-2, M3): only ever offered from legality.activatable. */
  const activate = (owner: PID, iid: Iid, effectIndex: number) => {
    setMode({ t: "idle" });
    dispatch({ type: "activateMain", player: owner, iid, effectIndex });
  };

  const onDonTap = (owner: PID, index: number) => {
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
      const ok = pc.upTo ? picked.length <= max : picked.length === max;
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
        returnToDeck: `put ${n} card${plural} from your hand at the bottom of your deck`,
      };
      const ACTION_LABEL: Record<string, string> = {
        koTarget: "K.O.", powerMod: "power change", restTarget: "rest", standTarget: "stand",
        discard: "discard", grantKeyword: "keyword", restriction: "restriction",
        returnToHand: "return to hand", playFromZone: "play", giveRestedDon: "give rested DON!! to",
        addFromTrashToHand: "return from trash", attachDonFromDeck: "attach DON!! to",
        costMod: "cost change", returnToDeck: "return to deck",
      };
      const title = paying
        ? `Pay the cost: ${COST_LABEL[pc.actionKind] ?? `${pc.actionKind} (${n})`}`
        : `choose ${n} target${plural} — ${ACTION_LABEL[pc.actionKind] ?? pc.actionKind}`;
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
    if (mode.t === "attack") {
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            <b>{cards.get(findCardId(game, mode.iid) ?? "")?.name ?? "Attacker"}</b> — tap a highlighted target.
          </span>
          <button className="ba-btn" data-act="cancel" onClick={() => setMode({ t: "idle" })}>Cancel</button>
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
    return null;
  })();

  // ── board pieces ────────────────────────────────────────────────────────────

  const highlightSets = useMemo(() => {
    const legal = new Set<Iid>();
    const target = new Set<Iid>();
    if (pc?.kind === "blockWindow") for (const b of pc.blockers) legal.add(b);
    if (pc?.kind === "counterWindow") {
      for (const c of lm.counterCards) legal.add(c.iid);
      for (const c of lm.counterEvents) legal.add(c.iid);
    }
    if (pc?.kind === "selectTargets") for (const c of pc.candidates) target.add(c.iid);
    if (!pc && game.phase === "main" && !game.battle) {
      if (mode.t === "attack") for (const t of mode.targets) target.add(t);
      else if (mode.t === "don") {
        const p = game.players[game.turnPlayer];
        target.add(p.leaderIid);
        for (const c of p.zones.characterArea) target.add(c);
      } else if (mode.t === "replace") {
        for (const c of game.players[game.turnPlayer].zones.characterArea) target.add(c);
      } else {
        for (const a of lm.attackers) legal.add(a.iid);
        for (const h of lm.playableFromHand) legal.add(h.iid);
      }
    }
    return { legal, target };
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
    const cls = [
      "gb-card",
      "ba-card",
      inst.rested ? "gb-rested" : "",
      small ? "ba-small" : "",
      highlightSets.legal.has(iid) ? "ba-legal" : "",
      highlightSets.target.has(iid) ? "ba-target" : "",
      picked.includes(iid) || (inHand && selectedHand === iid) ? "ba-picked" : "",
      mode.t === "attack" && mode.iid === iid ? "ba-attacker" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={iid}
        className={cls}
        data-iid={iid}
        ref={reg(iid)}
        onClick={(e) => {
          e.stopPropagation();
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
            {delta !== 0 && <i>{` (${delta > 0 ? "+" : ""}${delta})`}</i>}
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
        {given > 0 && <span className="ba-given">DON!! ×{given}</span>}
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
  }

  function PileBox({ label, count, children, faceClass, pid, tick }: { label: string; count: number; children?: React.ReactNode; faceClass?: string; pid: PID; tick?: boolean }) {
    const key = `${label.toLowerCase().replace(/[^a-z]/g, "")}-${pid}`; // life-seatA, trash-seatA, …
    return (
      <div className={`ba-pile ${faceClass ?? ""}`} data-pile={key}>
        <span className="ba-plabel">{label}</span>
        <div className="ba-pcard">{children ?? (count > 0 ? <div className="gb-card ba-backcard"><span className="gb-back"><span className="gb-back-emblem" /></span></div> : <div className="ba-empty" />)}</div>
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
        className={`ba-half${flip ? " flip" : ""}${isTurn ? " turn" : " idle"}${hitSeat === pid ? " ba-hit" : ""}`}
        data-half={pid}
        style={{ ["--lc" as string]: leaderHex(pid) }}
      >
        <div className="ba-sidecol">
          {PileBox({ label: "LIFE", count: p.zones.life.length, pid, tick: hitSeat === pid })}
          {PileBox({ label: "DON!! DECK", count: p.don.deck, faceClass: "ba-donback", pid })}
        </div>
        <div className="ba-halfmain">
          <div className="ba-charrow">
            {p.zones.characterArea.map((iid) => BCard({ owner: pid, iid }))}
            {Array.from({ length: Math.max(0, 5 - p.zones.characterArea.length) }).map((_, i) => (
              <div key={`slot${i}`} className="ba-slot" />
            ))}
          </div>
          <div className="ba-lsrow">
            {BCard({ owner: pid, iid: p.leaderIid })}
            {p.zones.stage.length > 0 ? (
              BCard({ owner: pid, iid: p.zones.stage[0] })
            ) : (
              <div className="ba-slot ba-stage">STAGE</div>
            )}
            <div className="ba-donrow" data-seat-don={pid} data-overlap="stride">
              {Array.from({ length: donActive }).map((_, i) => {
                const dialOn = isTurn && mode.t === "don" && mode.picked.includes(i + 1);
                const marked = (donMarks[pid] ?? []).includes(i);
                return (
                  <div
                    key={`a${i}`}
                    className={`gb-card ba-doncell${dialOn ? " ba-picked" : ""}${marked ? " ba-donmark" : ""}`}
                    data-don-index={i + 1}
                    data-don-seat={pid}
                    title={marked ? "Placeholder (visual only) — right-click to clear" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (longPressed.current) { longPressed.current = false; return; } // the long-press already acted
                      onDonTap(pid, i + 1);
                    }}
                    onPointerDown={(e) => donPressStart(pid, i, e.pointerType)}
                    onPointerUp={donPressEnd}
                    onPointerCancel={donPressEnd}
                    onPointerLeave={donPressEnd}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleDonMark(pid, i);
                    }}
                  >
                    <DonArt />
                    {marked && <span className="ba-donmark-tag">HOLD</span>}
                  </div>
                );
              })}
              {Array.from({ length: donRested }).map((_, i) => (
                <div key={`r${i}`} className="gb-card ba-doncell gb-rested ba-dim">
                  <DonArt />
                </div>
              ))}
              {donActive + donRested === 0 && <span className="ba-donempty">COST AREA</span>}
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
    return (
      <div className={`ba-hand${small ? " small" : ""}`} data-hand={pid} data-overlap="stride">
        {p.zones.hand.map((iid) => BCard({ owner: pid, iid, small, inHand: true }))}
        {p.zones.hand.length === 0 && <span className="ba-donempty">EMPTY HAND</span>}
      </div>
    );
  }

  function SeatPanel({ pid }: { pid: PID }) {
    const p = game.players[pid];
    const active = lm.actor === pid && game.phase !== "over";
    const arm = armConcede === pid;
    const mm = Math.floor((clocks[pid] ?? 0) / 60);
    const ss = (clocks[pid] ?? 0) % 60;
    return (
      <div className={`ba-seatpanel${active ? " active" : ""}${game.turnPlayer === pid && game.phase !== "over" ? " turn" : ""}`} style={{ ["--lc" as string]: leaderHex(pid) }}>
        <div className="ba-seatrow">
          <b className="ba-seatname">{seatName(pid)}</b>
          <span className="ba-clock">{mm}:{String(ss).padStart(2, "0")}</span>
        </div>
        <div className="ba-seatstats">
          <span>LIFE <b>{p.zones.life.length}</b></span>
          <span>DECK <b>{p.zones.deck.length}</b></span>
          <span>HAND <b>{p.zones.hand.length}</b></span>
          <span>DON <b>{p.don.active}</b>/{p.don.rested}r</span>
        </div>
        {game.phase !== "over" && (
          <button
            className={`ba-btn ghost tiny${arm ? " danger" : ""}`}
            data-act={`concede-${pid}`}
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
            {arm ? "Confirm concede?" : "Concede"}
          </button>
        )}
      </div>
    );
  }

  // ── log ─────────────────────────────────────────────────────────────────────
  const logRef = useRef<HTMLDivElement | null>(null);
  const logLines = useMemo(
    () => events.map((e) => fmtEvent(e, game, cards, seatName)).filter((l) => l !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, game],
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
      <div className="ba-overlay">
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
      <div className="ba-overlay">
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
      <div className="ba-overlay">
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
    const ok = pc.upTo ? picked.length <= max : picked.length === max;
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
    // M3 — look at the top N (8-4-4-4, 11-2-1): take up to takeCount among the
    // eligible, then arrange the rest as the card's disposition says
    const p = game.players[pc.player];
    const cardOf = (iid: Iid) => cards.get(p.instances[iid].cardId);
    const remaining = pc.cards.filter((iid) => !peekTake.includes(iid));
    const ordered = pc.rest === "topAnyOrder" || pc.rest === "bottomAnyOrder" || pc.rest === "topOrBottomAnyOrder";
    const sideOf = (iid: Iid): "top" | "bottom" => peekSide[iid] ?? (pc.rest === "bottomAnyOrder" ? "bottom" : "top");
    const inOrder = (list: Iid[]) => {
      const idx = (iid: Iid) => { const i = peekOrder.indexOf(iid); return i === -1 ? 999 + pc.cards.indexOf(iid) : i; };
      return [...list].sort((a, b) => idx(a) - idx(b));
    };
    const modeLabel = pc.mode === "hand" ? "add to your hand" : pc.mode === "play" ? `play${pc.playRested ? " (rested)" : ""}` : "look";
    const restLabel: Record<typeof pc.rest, string> = {
      topAnyOrder: "the rest goes back ON TOP, in the order you choose (1 = top)",
      bottomAnyOrder: "the rest goes to the BOTTOM, in the order you choose (1 = first placed)",
      topOrBottomAnyOrder: "split the rest between TOP and BOTTOM (tap Top/Bottom), ordered by your taps",
      shuffle: "the rest is shuffled back into the deck",
      trash: "the rest is trashed",
    };
    const confirmPeek = () => {
      let restTop: Iid[] = [];
      let restBottom: Iid[] = [];
      if (pc.rest === "topAnyOrder") restTop = peekOrder.length === remaining.length ? inOrder(remaining) : [];
      else if (pc.rest === "bottomAnyOrder") restBottom = peekOrder.length === remaining.length ? inOrder(remaining) : [];
      else if (pc.rest === "topOrBottomAnyOrder") {
        restTop = inOrder(remaining.filter((iid) => sideOf(iid) === "top"));
        restBottom = inOrder(remaining.filter((iid) => sideOf(iid) === "bottom"));
      }
      dispatch({ type: "respondPeek", player: pc.player, take: peekTake, restTop, restBottom });
    };
    overlay = (
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
              const pos = peekOrder.indexOf(iid);
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
                    setPeekOrder((prev) => prev.filter((x) => x !== iid));
                  }}
                >
                  <span className="ba-peekpos">#{i + 1}</span>
                  <div className="ba-peekart">{c?.image && <img src={c.image} alt={c.name} />}</div>
                  <b>{c?.name ?? iid}</b>
                  {taken && <i className="ba-peektag">{pc.mode === "play" ? "PLAY" : "TAKE"}</i>}
                  {!taken && ordered && (
                    <span className="ba-peekorder" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`ba-btn tiny${pos >= 0 ? " on" : ""}`}
                        data-act="peek-order"
                        data-peek-iid={iid}
                        onClick={() => setPeekOrder((prev) => (prev.includes(iid) ? prev.filter((x) => x !== iid) : [...prev, iid]))}
                      >
                        {pos >= 0 ? `${pos + 1}` : "order"}
                      </button>
                      {pc.rest === "topOrBottomAnyOrder" && (
                        <button
                          className="ba-btn tiny"
                          data-act="peek-side"
                          data-peek-iid={iid}
                          onClick={() => setPeekSide((prev) => ({ ...prev, [iid]: sideOf(iid) === "top" ? "bottom" : "top" }))}
                        >
                          {sideOf(iid) === "top" ? "Top" : "Bottom"}
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ba-ovbtns">
            {ordered && peekOrder.length > 0 && (
              <button className="ba-btn" data-act="peek-reset" onClick={() => setPeekOrder([])}>Reset order</button>
            )}
            <button className="ba-btn primary big" data-act="peek-confirm" onClick={confirmPeek}>
              Confirm{peekTake.length ? ` (${peekTake.length})` : " — take none"}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "payDon") {
    // M3 — DON!!−X (8-3-1-6): compose the payment from the cost area and the
    // attached DON!!; "Auto" = rested first, then active, then attached
    const p = game.players[pc.player];
    const total = payPlan.fromActive + payPlan.fromRested + Object.values(payPlan.fromGiven).reduce((s, n) => s + n, 0);
    const bump = (key: "fromActive" | "fromRested" | Iid, max: number, delta: number) =>
      setPayPlan((prev) => {
        if (key === "fromActive" || key === "fromRested") {
          return { ...prev, [key]: Math.max(0, Math.min(max, prev[key] + delta)) };
        }
        const cur = prev.fromGiven[key] ?? 0;
        return { ...prev, fromGiven: { ...prev.fromGiven, [key]: Math.max(0, Math.min(max, cur + delta)) } };
      });
    const auto = () => {
      let left = pc.amount;
      const plan = { fromActive: 0, fromRested: 0, fromGiven: {} as Record<Iid, number> };
      plan.fromRested = Math.min(left, p.don.rested); left -= plan.fromRested;
      plan.fromActive = Math.min(left, p.don.active); left -= plan.fromActive;
      for (const [iid, n] of Object.entries(p.don.given)) {
        if (left <= 0) break;
        const take = Math.min(left, n);
        if (take > 0) { plan.fromGiven[iid] = take; left -= take; }
      }
      setPayPlan(plan);
    };
    const row = (label: string, key: "fromActive" | "fromRested" | Iid, max: number, value: number) => (
      <div className="ba-payrow" key={key}>
        <span className="ba-paylabel">{label} <i>({max} available)</i></span>
        <span className="ba-stepper">
          <button className="ba-btn tiny" data-act={`paydon-minus-${key}`} disabled={value <= 0} onClick={() => bump(key, max, -1)}>−</button>
          <b>{value}</b>
          <button className="ba-btn tiny" data-act={`paydon-plus-${key}`} disabled={value >= max || total >= pc.amount} onClick={() => bump(key, max, +1)}>+</button>
        </span>
      </div>
    );
    overlay = (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov ba-paydon">
          <span className="ba-ovtag">{seatName(pc.player)} — DON!!−{pc.amount}</span>
          <p className="ba-ovtext">Return <b>{pc.amount}</b> DON!! to your DON!! deck. Choose where they come from (8-3-1-6).</p>
          <div className="ba-payrows">
            {row("Cost area — rested DON!!", "fromRested", p.don.rested, payPlan.fromRested)}
            {row("Cost area — active DON!!", "fromActive", p.don.active, payPlan.fromActive)}
            {Object.entries(p.don.given).map(([iid, n]) =>
              row(`On ${cards.get(p.instances[iid].cardId)?.name ?? iid}`, iid, n, payPlan.fromGiven[iid] ?? 0))}
          </div>
          <p className={`ba-paytotal${total === pc.amount ? " ok" : ""}`}>{total} / {pc.amount}</p>
          <div className="ba-ovbtns">
            <button className="ba-btn" data-act="paydon-auto" onClick={auto}>Auto (rested first)</button>
            <button
              className="ba-btn primary big"
              data-act="paydon-confirm"
              disabled={total !== pc.amount}
              onClick={() => dispatch({ type: "respondPayDon", player: pc.player, ...payPlan })}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pc?.kind === "chooseNumber") {
    // M3 — "draw up to N" (8-4-4-1: 'up to' allows 0)
    const src = cards.get(findCardId(game, pc.sourceIid) ?? "");
    const value = numberPick ?? pc.max;
    overlay = (
      <div className="ba-overlay">
        <div className="ba-panel ba-ov">
          <span className="ba-ovtag">{seatName(pc.player)} — {pc.purpose === "draw" ? `draw up to ${pc.max}` : "choose a number"}</span>
          {src && <b className="ba-ovname">{src.name}</b>}
          <p className="ba-ovtext">How many cards do you draw?</p>
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

  const battleStep = game.battle ? game.battle.step : null;
  const phaseLabel =
    game.phase === "setup" ? "SETUP" : game.phase === "over" ? "GAME OVER" : battleStep ? `${battleStep.toUpperCase()} STEP` : "MAIN PHASE";

  // preview rail content
  const previewPanel = preview ? (
    <>
      <div className="ba-prevart">{preview.image && <img src={preview.image} alt={preview.name} />}</div>
      <b className="ba-prevname">{preview.name}</b>
      <span className="ba-prevline">
        {preview.category.toUpperCase()} · {preview.category === "Leader" ? `LIFE ${preview.cost ?? 0}` : `COST ${preview.cost ?? 0}`}
        {preview.power != null && ` · POW ${preview.power}`}
        {preview.counter ? ` · CTR +${preview.counter}` : ""}
      </span>
      <span className="ba-prevline">{preview.colors.join("/")} · {preview.types.join(", ")}</span>
      <div className="ba-prevfx">
        {preview.effect && preview.effect !== "-" ? preview.effect : "(no effect text)"}
        {preview.trigger
          ? `\n\n${preview.trigger.trimStart().startsWith("[Trigger]") ? preview.trigger : `[Trigger] ${preview.trigger}`}`
          : ""}
      </div>
      {automationInfo(preview).note && <div className="ba-prevnote">{automationInfo(preview).note}</div>}
    </>
  ) : (
    <div className="ba-prevempty">Tap or hover a card to inspect it.</div>
  );

  const endTurnButton = (
    <button
      className="ba-btn primary big ba-endturn"
      data-act="endturn"
      disabled={!lm.canEndTurn}
      title={`${seatName(game.turnPlayer)}'s turn`}
      style={{ ["--lc" as string]: leaderHex(game.turnPlayer) }}
      onClick={() => dispatch({ type: "endTurn", player: game.turnPlayer })}
    >
      End turn
    </button>
  );

  return (
    <div className="ba-stagewrap" data-stage-scale={stage.scale.toFixed(4)} data-stage-rotate={stage.rotate ? "1" : "0"}>
    <div
      className="ba-root ba-game ba-stage"
      style={{ transform: stageTransform(stage) }}
      onClick={() => { if (mode.t !== "idle") setMode({ t: "idle" }); }}
    >
      <Banner />

      <div className="ba-left">
        {/* turn toast sits IN the rail flow (never over the table or rail) */}
        {toast && <div className="ba-toast">{toast}</div>}
        <div className="ba-preview">{previewPanel}</div>
        <div className="ba-turnbox">
          <span className="ba-turnpill">TURN <b>{Math.max(1, game.turn)}</b></span>
          <span className="ba-phasepill">{phaseLabel}</span>
        </div>
        {endTurnButton}
        <button className="ba-btn ghost" data-act="exit" onClick={() => setView("home")}>Exit to Home</button>
      </div>

      <div className="ba-centercol">
        {HandRow({ pid: SEAT_B, small: true })}
        <div className="ba-field" ref={fieldRef}>
          {Half({ pid: SEAT_B, flip: true })}
          <div className="ba-midline" />
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
          {fxList.map((f) => (
            <div
              key={f.id}
              className={`ba-fx ${f.kind}`}
              style={{ left: f.x, top: f.y, width: f.w, height: f.h, ["--dx" as string]: `${f.dx}px`, ["--dy" as string]: `${f.dy}px` }}
              onAnimationEnd={() => setFxList((l) => l.filter((x) => x.id !== f.id))}
            >
              {f.kind === "ko" && f.cardId && cards.get(f.cardId)?.image
                ? <img src={cards.get(f.cardId)!.image} alt="" />
                : <span className="gb-back"><span className="gb-back-emblem" /></span>}
            </div>
          ))}
        </div>
        {actionBar}
        {HandRow({ pid: SEAT_A })}
      </div>

      <div className="ba-right">
        {SeatPanel({ pid: SEAT_B })}
        <div className="ba-log" ref={logRef}>
          {logLines.map((l, i) => (
            <p key={i} className={`ba-logline ${l!.kind}`}>{l!.text}</p>
          ))}
        </div>
        {SeatPanel({ pid: SEAT_A })}
      </div>

      {overlay}
    </div>
    </div>
  );
}
