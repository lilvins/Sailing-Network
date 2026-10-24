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
import "./boardauto-compact.css";

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
  };
}

// ─── viewport mode ────────────────────────────────────────────────────────────

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Compact chrome: phone landscape (short viewport) or narrow portrait. The
 *  desktop grid stays untouched above these. Mirrored by `.compact` in CSS. */
const COMPACT_QUERY = "(max-width: 1024px) and (max-height: 560px), (max-width: 820px) and (orientation: portrait)";
const PORTRAIT_QUERY = "(orientation: portrait)";

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
          <button className="ba-btn primary big" data-act="roll" onClick={doRoll}>Roll</button>
        ) : (
          <>
            <p className="ba-rollwin">
              <b>{winner!.name}</b> wins the roll and chooses:
            </p>
            <div className="ba-rollchoices">
              <button className="ba-btn primary" data-act="first" onClick={() => chooseFirst(roll.winnerIdx)}>
                Play first <i>(no draw, 1 DON!!)</i>
              </button>
              <button className="ba-btn" data-act="second" onClick={() => chooseFirst(roll.winnerIdx === 0 ? 1 : 0)}>
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
  | { t: "don"; count: number }
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
  // compact (phone) chrome: sheets instead of rails, 2-tap play from hand
  const compact = useMediaQuery(COMPACT_QUERY);
  const portrait = useMediaQuery(PORTRAIT_QUERY);
  const [portraitOk, setPortraitOk] = useState(false);
  const [sheet, setSheet] = useState<"preview" | "log" | null>(null);
  const [selectedHand, setSelectedHand] = useState<Iid | null>(null);
  useEffect(() => {
    if (!compact) setSheet(null);
  }, [compact]);
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
  }, [pc?.kind, game.turn, game.battle?.step, game.phase]);

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
  useLayoutEffect(() => {
    const field = fieldRef.current;
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
    if (!field || !from || !to || !owner) {
      setArrow(null);
      return;
    }
    const a = nodeMap.current.get(from)?.getBoundingClientRect();
    const b = nodeMap.current.get(to)?.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    if (!a || !b) {
      setArrow(null);
      return;
    }
    setArrow({
      x1: a.left + a.width / 2 - f.left,
      y1: a.top + a.height / 2 - f.top,
      x2: b.left + b.width / 2 - f.left,
      y2: b.top + b.height / 2 - f.top,
      color: leaderHex(owner),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.battle?.attackerIid, game.battle?.targetIid, mode, hoverTarget, events.length]);

  // ── tap routing ─────────────────────────────────────────────────────────────

  const hover = (cardId: string | null) => {
    if (!cardId) return;
    const c = cards.get(cardId);
    if (c) setPreview(c);
  };
  /** A tap that performs NO action: desktop = preview rail (already set by
   *  hover); compact = open the preview sheet (no hover on touch). */
  const inspect = (cardId: string | null) => {
    hover(cardId);
    if (compact && cardId) setSheet("preview");
  };

  /** Play a hand card (shared by the desktop 1-tap, the compact 2nd tap and
   *  the sheet's Play button). */
  const playFromHand = (owner: PID, iid: Iid) => {
    const playable = lm.playableFromHand.find((x) => x.iid === iid);
    if (!playable) return;
    const card = cards.get(game.players[owner].instances[iid].cardId);
    setSelectedHand(null);
    setSheet(null);
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
    if (compact && selectedHand !== iid) {
      // touch: 1st tap selects + shows the card, 2nd tap (or the sheet's
      // Play button) plays it — no accidental plays on a small screen
      setSelectedHand(iid);
      inspect(inst.cardId);
      return;
    }
    playFromHand(owner, iid);
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
    if (pc) { inspect(cardId); return; }

    if (mode.t === "don") {
      const me = game.turnPlayer;
      const p = game.players[me];
      if (owner === me && (iid === p.leaderIid || p.zones.characterArea.includes(iid))) {
        const n = mode.count;
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
      const isBoard = iid === game.players[owner].leaderIid || game.players[owner].zones.characterArea.includes(iid);
      if (isBoard && inst.rested) explain("This card is rested — it already acted.", "It stands in your next Refresh Phase.");
      else if (isBoard && game.turn <= 2) explain("No battles on either player's first turn (6-5-6-1).");
      inspect(cardId);
      return;
    }
    if (mode.t === "attack") { setMode({ t: "idle" }); return; }
    inspect(cardId);
  };

  const onDonTap = (owner: PID, index: number) => {
    if (pc) return;
    if (game.phase !== "main" || game.battle) return;
    if (owner !== game.turnPlayer) {
      explain("DON!! can be given only in your own Main Phase (6-5-5).");
      return;
    }
    setMode(mode.t === "don" && mode.count === index ? { t: "idle" } : { t: "don", count: index });
  };

  // ── action bar (ONE contextual button, bottom-center) ───────────────────────

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
    if (pc?.kind === "selectTargets") {
      const max = Math.min(pc.count, pc.candidates.length);
      const ok = pc.upTo ? picked.length <= max : picked.length === max;
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            <b>{seatName(pc.player)}</b> — choose {pc.upTo ? `up to ${pc.count}` : `${max}`} target{max === 1 ? "" : "s"} ({pc.actionKind})
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
      return (
        <div className="ba-actionbar">
          <span className="ba-actlabel">
            Give <b>{mode.count} DON!!</b> — tap your Leader or a Character. Tap elsewhere to cancel.
          </span>
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
      </div>
    );
  }

  function PileBox({ label, count, children, faceClass }: { label: string; count: number; children?: React.ReactNode; faceClass?: string }) {
    return (
      <div className={`ba-pile ${faceClass ?? ""}`}>
        <span className="ba-plabel">{label}</span>
        <div className="ba-pcard">{children ?? (count > 0 ? <div className="gb-card ba-backcard"><span className="gb-back"><span className="gb-back-emblem" /></span></div> : <div className="ba-empty" />)}</div>
        <span className="ba-pcount">{count}</span>
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
      <div className={`ba-half${flip ? " flip" : ""}${isTurn ? " turn" : ""}`} style={{ ["--lc" as string]: leaderHex(pid) }}>
        <div className="ba-sidecol">
          {PileBox({ label: "LIFE", count: p.zones.life.length })}
          {PileBox({ label: "DON!! DECK", count: p.don.deck, faceClass: "ba-donback" })}
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
            <div className="ba-donrow" data-seat-don={pid}>
              {Array.from({ length: donActive }).map((_, i) => {
                const dialOn = isTurn && mode.t === "don" && i < mode.count;
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
            children:
              trashTop && trashCard ? (
                <div
                  className="gb-card ba-backcard"
                  data-iid={trashTop}
                  onClick={(e) => {
                    e.stopPropagation();
                    inspect(trashCard.id);
                  }}
                >
                  <CardArt inst={{ instanceId: trashTop, cardId: trashCard.id, faceUp: true, rested: false }} card={trashCard} />
                </div>
              ) : undefined,
          })}
          {PileBox({ label: "DECK", count: p.zones.deck.length })}
        </div>
      </div>
    );
  }

  function HandRow({ pid, small }: { pid: PID; small?: boolean }) {
    const p = game.players[pid];
    return (
      <div className={`ba-hand${small ? " small" : ""}`} data-hand={pid}>
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
      <div className={`ba-seatpanel${active ? " active" : ""}`} style={{ ["--lc" as string]: leaderHex(pid) }}>
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
    game.phase === "setup" ? "SETUP" : game.phase === "over" ? "GAME OVER" : battleStep ? `BATTLE · ${battleStep.toUpperCase()}` : "MAIN PHASE";

  // shared preview content (desktop rail / compact sheet)
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
      className="ba-btn primary big"
      data-act="endturn"
      disabled={!lm.canEndTurn}
      onClick={() => dispatch({ type: "endTurn", player: game.turnPlayer })}
    >
      End turn
    </button>
  );

  // compact chrome: minimal seat pill for the overlay strips
  const seatPill = (pid: PID) => {
    const p = game.players[pid];
    const active = lm.actor === pid && game.phase !== "over";
    const sec = clocks[pid] ?? 0;
    return (
      <div className={`ba-m-pill${active ? " active" : ""}`} style={{ ["--lc" as string]: leaderHex(pid) }}>
        <b>{seatName(pid)}</b>
        <span>
          {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")} · L{p.zones.life.length} · D{p.zones.deck.length} · H{p.zones.hand.length} · DON {p.don.active}/{p.don.rested}
        </span>
      </div>
    );
  };

  const selectedHandOwner = selectedHand ? (game.players[SEAT_A].zones.hand.includes(selectedHand) ? SEAT_A : SEAT_B) : null;
  const selectedPlayable = !!selectedHand && selectedHandOwner === game.turnPlayer && lm.playableFromHand.some((x) => x.iid === selectedHand);

  const compactChrome = compact && (
    <>
      <div className="ba-m-strip top">
        {seatPill(SEAT_B)}
        {HandRow({ pid: SEAT_B, small: true })}
        <span className="ba-m-turn">T{Math.max(1, game.turn)} · {phaseLabel}</span>
      </div>
      <div className="ba-m-strip bottom">
        {seatPill(SEAT_A)}
        {HandRow({ pid: SEAT_A })}
        <div className="ba-m-bar">
          {endTurnButton}
          <button className={`ba-btn${sheet === "log" ? " on" : ""}`} data-act="sheet-log" onClick={(e) => { e.stopPropagation(); setSheet(sheet === "log" ? null : "log"); }}>Log</button>
          <button className={`ba-btn${sheet === "preview" ? " on" : ""}`} data-act="sheet-preview" onClick={(e) => { e.stopPropagation(); setSheet(sheet === "preview" ? null : "preview"); }}>Card</button>
        </div>
      </div>
      {sheet && (
        <>
          <div className="ba-sheet-backdrop" onClick={(e) => { e.stopPropagation(); setSheet(null); setSelectedHand(null); }} />
          <div className={`ba-sheet ${sheet === "preview" ? "left" : "right"}`} onClick={(e) => e.stopPropagation()}>
            <div className="ba-sheet-head">
              <b>{sheet === "preview" ? "CARD" : "LOG & SEATS"}</b>
              <button className="ba-btn tiny" data-act="sheet-close" onClick={() => { setSheet(null); setSelectedHand(null); }}>Close</button>
            </div>
            {sheet === "preview" ? (
              <div className="ba-sheet-body ba-preview">
                {previewPanel}
                {selectedPlayable && selectedHand && selectedHandOwner && (
                  <button className="ba-btn primary big" data-act="play-selected" onClick={() => playFromHand(selectedHandOwner, selectedHand)}>
                    Play this card
                  </button>
                )}
              </div>
            ) : (
              <div className="ba-sheet-body">
                {SeatPanel({ pid: SEAT_B })}
                <div className="ba-log ba-sheet-log">
                  {logLines.map((l, i) => (
                    <p key={i} className={`ba-logline ${l!.kind}`}>{l!.text}</p>
                  ))}
                </div>
                {SeatPanel({ pid: SEAT_A })}
                <button className="ba-btn ghost" data-act="exit" onClick={() => setView("home")}>Exit to Home</button>
              </div>
            )}
          </div>
        </>
      )}
      {portrait && !portraitOk && (
        <div className="ba-rotate" role="dialog">
          <div className="ba-rotate-box">
            <svg className="ba-rotate-icon" viewBox="0 0 48 48" aria-hidden shapeRendering="crispEdges">
              <rect x="6" y="14" width="36" height="20" fill="none" stroke="currentColor" strokeWidth="3" />
              <rect x="36" y="22" width="3" height="4" fill="currentColor" />
              <path d="M24 4 L30 9 L24 14 Z" fill="currentColor" />
              <path d="M24 44 L18 39 L24 34 Z" fill="currentColor" />
            </svg>
            <b>ROTATE YOUR PHONE</b>
            <p>The table is built for landscape: two mirrored halves, hands on the edges, everything in one screen.</p>
            <button className="ba-btn ghost" data-act="portrait-anyway" onClick={() => setPortraitOk(true)}>Continue anyway</button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className={`ba-root ba-game${compact ? " compact" : ""}`} onClick={() => { if (mode.t !== "idle") setMode({ t: "idle" }); }}>
      <Banner />
      {toast && <div className="ba-toast">{toast}</div>}

      {!compact && (
        <div className="ba-left">
          <div className="ba-preview">{previewPanel}</div>
          <div className="ba-turnbox">
            <span className="ba-turnpill">TURN <b>{Math.max(1, game.turn)}</b></span>
            <span className="ba-phasepill">{phaseLabel}</span>
          </div>
          {endTurnButton}
          <button className="ba-btn ghost" data-act="exit" onClick={() => setView("home")}>Exit to Home</button>
        </div>
      )}

      <div className="ba-centercol">
        {!compact && HandRow({ pid: SEAT_B, small: true })}
        <div className="ba-field" ref={fieldRef}>
          {Half({ pid: SEAT_B, flip: true })}
          <div className="ba-midline" />
          {Half({ pid: SEAT_A, flip: false })}
          {arrow && (
            <svg className="ba-arrow" aria-hidden>
              <defs>
                <marker id="ba-arrowhead" markerWidth="7" markerHeight="7" refX="5.4" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill={arrow.color} />
                </marker>
              </defs>
              <path
                d={`M${arrow.x1},${arrow.y1} Q${(arrow.x1 + arrow.x2) / 2 + 40},${(arrow.y1 + arrow.y2) / 2} ${arrow.x2},${arrow.y2}`}
                fill="none"
                stroke={arrow.color}
                strokeWidth="3"
                strokeDasharray="8 6"
                markerEnd="url(#ba-arrowhead)"
              />
            </svg>
          )}
        </div>
        {actionBar}
        {!compact && HandRow({ pid: SEAT_A })}
      </div>

      {!compact && (
        <div className="ba-right">
          {SeatPanel({ pid: SEAT_B })}
          <div className="ba-log" ref={logRef}>
            {logLines.map((l, i) => (
              <p key={i} className={`ba-logline ${l!.kind}`}>{l!.text}</p>
            ))}
          </div>
          {SeatPanel({ pid: SEAT_A })}
        </div>
      )}

      {compactChrome}
      {overlay}
    </div>
  );
}
