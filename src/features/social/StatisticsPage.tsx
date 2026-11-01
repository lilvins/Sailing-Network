import { useEffect, useMemo, useRef, useState } from "react";
import { Header, Dock } from "../profiles/ProfilePages";
import { api, type DeckStats, type DeckMatchup } from "../../lib/api";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { WinRate, WinRateBar } from "../stats/StatBits";
import { pct, showPct, wilson, SMALL_SAMPLE } from "../stats/format";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";
import "../stats/stats.css";
import { PixelScene } from "../pixel/PixelScene";

/* My Statistics — pick one of your decks (or one of your leaders, which adds
   up every deck you built on it), choose a time window, then see its win rate
   (overall / going 1st / going 2nd) and the win rate vs each leader you've
   faced. Every number shows how many games it rests on and its 95% range.
   Data: /api/me/stats?days= (real match history). */

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "All time" },
];

interface Group {
  key: string;
  title: string;
  sub: string;
  leaderId: string | null;
  games: number; wins: number;
  games1: number; wins1: number;
  games2: number; wins2: number;
  matchups: DeckMatchup[];
}

const gamesLabel = (n: number) => `${n} game${n === 1 ? "" : "s"}`;

/** Adds up decks that share a leader, matchup by matchup. */
function byLeader(decks: DeckStats[], nameOf: (id: string | null) => string): Group[] {
  const map = new Map<string, Group & { deckCount: number }>();
  for (const d of decks) {
    const k = d.leaderId || "?";
    const g = map.get(k) || { key: k, title: nameOf(d.leaderId), sub: "", leaderId: d.leaderId, games: 0, wins: 0, games1: 0, wins1: 0, games2: 0, wins2: 0, matchups: [], deckCount: 0 };
    g.deckCount++;
    g.games += d.games; g.wins += d.wins; g.games1 += d.games1; g.wins1 += d.wins1; g.games2 += d.games2; g.wins2 += d.wins2;
    for (const m of d.matchups) {
      const e = g.matchups.find((x) => x.oppLeaderId === m.oppLeaderId);
      if (e) { e.games += m.games; e.wins += m.wins; e.games1 += m.games1; e.wins1 += m.wins1; e.games2 += m.games2; e.wins2 += m.wins2; }
      else g.matchups.push({ ...m });
    }
    map.set(k, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, sub: `${g.leaderId || "?"} · ${g.deckCount} deck${g.deckCount === 1 ? "" : "s"} · ${gamesLabel(g.games)}`, matchups: g.matchups.sort((a, b) => b.games - a.games) }))
    .sort((a, b) => b.games - a.games);
}

export function StatisticsPage() {
  const openProfile = useUiStore((s) => s.openProfile);
  const me = useAuthStore((s) => s.user);
  const [decks, setDecks] = useState<DeckStats[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(0);
  const [mode, setMode] = useState<"deck" | "leader">("deck");
  const [muSort, setMuSort] = useState<"games" | "best" | "worst">("games");
  const [key, setKey] = useState<string>("");

  useEffect(() => {
    loadCardsById().then(setCards).catch(() => {});
  }, []);
  useEffect(() => {
    setLoading(true);
    api.myStats(days)
      .then(({ decks }) => { setDecks(decks); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  const leaderColorOf = (id: string | null) => { const c = id ? cards?.get(id) : null; return c ? cardColorHex(c) : "#3a4a5e"; };
  const leaderNameOf = (id: string | null) => (id && cards?.get(id)?.name) || id || "—";
  const leaderImageOf = (id: string | null) => (id ? cards?.get(id)?.image || null : null);

  const groups: Group[] = useMemo(
    () =>
      mode === "deck"
        ? decks
            .map((d) => ({ ...d, key: d.deckId, title: d.name, sub: `${d.leaderName || leaderNameOf(d.leaderId)} · ${gamesLabel(d.games)}` }))
            .sort((a, b) => b.games - a.games)
        : byLeader(decks, leaderNameOf),
    [decks, mode, cards],
  );
  useEffect(() => {
    if (!groups.some((g) => g.key === key)) setKey(groups[0]?.key || "");
  }, [groups, key]);

  const sel = groups.find((g) => g.key === key) || null;
  const overall = sel ? pct(sel.wins, sel.games) : null;
  const wr1 = sel ? pct(sel.wins1, sel.games1) : null;
  const wr2 = sel ? pct(sel.wins2, sel.games2) : null;
  const ci = sel ? wilson(sel.wins, sel.games) : null;

  const matchups = useMemo(() => {
    const list = (sel?.matchups || []).map((m) => ({
      id: m.oppLeaderId,
      name: leaderNameOf(m.oppLeaderId),
      color: leaderColorOf(m.oppLeaderId),
      image: leaderImageOf(m.oppLeaderId),
      games: m.games,
      wr: pct(m.wins, m.games),
      ci: wilson(m.wins, m.games),
      games1: m.games1, wr1: pct(m.wins1, m.games1),
      games2: m.games2, wr2: pct(m.wins2, m.games2),
    }));
    if (muSort === "games") return list.sort((a, b) => b.games - a.games);
    // best/worst: rank by the cautious end of the range so 2-0 doesn't beat 30-10
    return list.sort((a, b) => (muSort === "best" ? (b.ci?.[0] ?? 0) - (a.ci?.[0] ?? 0) : (a.ci?.[1] ?? 100) - (b.ci?.[1] ?? 100)));
  }, [sel, cards, muSort]);

  // horizontal matchup track: arrows appear only when it overflows
  const trackRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState({ left: false, right: false });
  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setOver({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateArrows();
    const raf = requestAnimationFrame(updateArrows);
    const t = setTimeout(updateArrows, 350);
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    window.addEventListener("resize", updateArrows);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); ro.disconnect(); window.removeEventListener("resize", updateArrows); };
  }, [key, matchups.length]);
  const scrollTrack = (dir: number) => trackRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  const hasOverflow = over.left || over.right;

  return (
    <div className="sn snp px">
      <PixelScene kind="sunset" />
      <Header
        title="My Statistics"
        sub="Win rate by deck, leader & matchup"
        hero="/assets/bg/sec-statistics.png"
        right={<span className="rk-myrank-v" style={{ fontSize: 16 }}>{showPct(overall)} WR</span>}
      />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="rec-toolbar">
            <div className="sx-seg" role="group" aria-label="Time window">
              {WINDOWS.map((w) => (
                <button key={w.days} className={days === w.days ? "on" : ""} onClick={() => setDays(w.days)}>{w.label}</button>
              ))}
            </div>
            <div className="sx-seg" role="group" aria-label="Group by">
              <button className={mode === "deck" ? "on" : ""} onClick={() => setMode("deck")}>By deck</button>
              <button className={mode === "leader" ? "on" : ""} onClick={() => setMode("leader")}>By leader</button>
            </div>
            <div className="spacer" />
            {me && (
              <button className="sn-btn-ghost st3-profile" onClick={() => openProfile(me.username)}>Bounty & full profile →</button>
            )}
          </div>
        </div>
        {loading && decks.length === 0 ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading your stats…</div></div>
        ) : decks.length === 0 ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No decks yet — build one in the Deck Constructor.</div></div>
        ) : (
          <div className="snp-wrap st2-layout" style={{ opacity: loading ? 0.6 : 1 }}>
            {/* LEFT: deck / leader selector */}
            <div className="so-card st2-decks">
              <div className="so-card-h">{mode === "deck" ? "Your Decks" : "Your Leaders"}</div>
              {groups.map((d) => (
                <button key={d.key} className={"st2-deck" + (d.key === key ? " on" : "")} onClick={() => setKey(d.key)}>
                  <span className="st2-deck-art" style={{ background: `linear-gradient(160deg, ${leaderColorOf(d.leaderId)}, #0a0f17)` }}>
                    {leaderImageOf(d.leaderId) && <img src={leaderImageOf(d.leaderId)!} alt="" loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                  </span>
                  <span className="st2-deck-main">
                    <div className="st2-deck-name">{d.title}</div>
                    <div className="st2-deck-sub">{d.sub}{d.games > 0 && <> · <b className={(pct(d.wins, d.games) ?? 0) >= 50 ? "win-c" : "loss-c"}>{showPct(pct(d.wins, d.games))}</b></>}</div>
                  </span>
                </button>
              ))}
            </div>

            {/* RIGHT: stats for the selection */}
            <div className="st2-content" key={key + days}>
              <div className="st-overview">
                <div className="st-kpi">
                  <div className="st-kpi-lbl">Overall Win Rate</div>
                  <div className={"st-kpi-val " + (overall != null && overall >= 50 ? "green" : "")}>{showPct(overall)}</div>
                  <div className="st-kpi-sub">{sel?.wins ?? 0}W – {sel ? sel.games - sel.wins : 0}L{ci ? ` · 95% ${showPct(ci[0])}–${showPct(ci[1])}` : ""}</div>
                </div>
                <div className="st-kpi">
                  <div className="st-kpi-lbl">WR going 1st</div>
                  <div className={"st-kpi-val " + (wr1 != null && wr1 >= 50 ? "green" : "")}>{showPct(wr1)}</div>
                  <div className="st-kpi-sub">{gamesLabel(sel?.games1 || 0)} on the play</div>
                </div>
                <div className="st-kpi">
                  <div className="st-kpi-lbl">WR going 2nd</div>
                  <div className={"st-kpi-val " + (wr2 != null && wr2 >= 50 ? "green" : "")}>{showPct(wr2)}</div>
                  <div className="st-kpi-sub">{gamesLabel(sel?.games2 || 0)} on the draw</div>
                </div>
              </div>

              <div className="so-card">
                <div className="so-card-h st3-muh">
                  <span>Win rate vs each leader</span>
                  <div className="sx-seg" role="group" aria-label="Sort matchups">
                    <button className={muSort === "games" ? "on" : ""} onClick={() => setMuSort("games")}>Most faced</button>
                    <button className={muSort === "best" ? "on" : ""} onClick={() => setMuSort("best")}>Best</button>
                    <button className={muSort === "worst" ? "on" : ""} onClick={() => setMuSort("worst")}>Worst</button>
                  </div>
                </div>
                {matchups.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)" }}>No matches recorded in this window.</div>
                ) : (
                  <div className="st2-mu-wrap">
                    {hasOverflow && (
                      <button className="st2-arrow" onClick={() => scrollTrack(-1)} disabled={!over.left} aria-label="Scroll left">‹</button>
                    )}
                    <div className="st2-mu-track" ref={trackRef} onScroll={updateArrows}>
                      {matchups.map((m) => (
                        <div className={"st2-mu" + (m.games < SMALL_SAMPLE ? " st3-small" : "")} key={m.id}>
                          <div className="st2-mu-art" style={{ background: `linear-gradient(160deg, ${m.color}, #0a0f17)` }}>
                            {m.image
                              ? <img src={m.image} alt={m.name} loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                              : <span>{m.name[0]}</span>}
                          </div>
                          <div className="st2-mu-name">{m.name}</div>
                          <div className="st3-mu-wr">
                            <WinRate rate={m.wr} games={m.games} ci={m.ci} />
                            <WinRateBar rate={m.wr} ci={m.ci} />
                          </div>
                          <div className="st2-mu-wrs">
                            <div className="st2-mu-wr"><span className="lbl">1st · {m.games1}</span><b className={m.wr1 != null && m.wr1 >= 50 ? "good" : "bad"}>{showPct(m.wr1)}</b></div>
                            <div className="st2-mu-wr"><span className="lbl">2nd · {m.games2}</span><b className={m.wr2 != null && m.wr2 >= 50 ? "good" : "bad"}>{showPct(m.wr2)}</b></div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {hasOverflow && (
                      <button className="st2-arrow" onClick={() => scrollTrack(1)} disabled={!over.right} aria-label="Scroll right">›</button>
                    )}
                  </div>
                )}
                <p className="sx-note" style={{ padding: "0 18px 14px" }}>
                  Faded cards rest on fewer than {SMALL_SAMPLE} games. Best/Worst rank by the cautious end of the 95% range, so a lucky 2–0 doesn't top the list.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      <Dock />
    </div>
  );
}
