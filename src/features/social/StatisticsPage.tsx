import { useEffect, useMemo, useRef, useState } from "react";
import { Header, Dock } from "../profiles/ProfilePages";
import { api, type DeckStats } from "../../lib/api";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";

/* My Statistics — pick one of your real decks, then see its win rate (overall /
   going 1st / going 2nd) and the win rate vs each leader you've actually faced.
   All numbers come from your real match history (/api/me/stats). */

const pct = (w: number, g: number) => (g > 0 ? Math.round((w / g) * 100) : null);
const good = (n: number | null) => (n != null && n >= 50 ? "good" : "bad");
const showPct = (n: number | null) => (n == null ? "—" : n + "%");

export function StatisticsPage() {
  const [decks, setDecks] = useState<DeckStats[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [loading, setLoading] = useState(true);
  const [deckId, setDeckId] = useState<string>("");

  useEffect(() => {
    Promise.all([api.myStats(), loadCardsById()])
      .then(([{ decks }, m]) => {
        setDecks(decks);
        setCards(m);
        setDeckId(decks[0]?.deckId || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const deck = decks.find((d) => d.deckId === deckId) || null;
  const leaderColorOf = (id: string | null) => { const c = id ? cards?.get(id) : null; return c ? cardColorHex(c) : "#3a4a5e"; };
  const leaderNameOf = (id: string | null) => (id && cards?.get(id)?.name) || id || "—";
  const leaderImageOf = (id: string | null) => (id ? cards?.get(id)?.image || null : null);

  const overall = deck ? pct(deck.wins, deck.games) : null;
  const wr1 = deck ? pct(deck.wins1, deck.games1) : null;
  const wr2 = deck ? pct(deck.wins2, deck.games2) : null;

  const matchups = useMemo(
    () =>
      (deck?.matchups || []).map((m) => ({
        id: m.oppLeaderId,
        name: leaderNameOf(m.oppLeaderId),
        color: leaderColorOf(m.oppLeaderId),
        image: leaderImageOf(m.oppLeaderId),
        games: m.games,
        wr1: pct(m.wins1, m.games1),
        wr2: pct(m.wins2, m.games2),
      })),
    [deck, cards],
  );

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
  }, [deckId, matchups.length]);
  const scrollTrack = (dir: number) => trackRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  const hasOverflow = over.left || over.right;

  return (
    <div className="sn snp">
      <Header
        title="My Statistics"
        sub="Win rate by deck & matchup"
        hero="/assets/bg/sec-statistics.png"
        right={<span className="rk-myrank-v" style={{ fontSize: 16 }}>{showPct(overall)} WR</span>}
      />
      <div className="snp-body">
        {loading ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading your stats…</div></div>
        ) : decks.length === 0 ? (
          <div className="snp-wrap"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No decks yet — build one in the Deck Constructor.</div></div>
        ) : (
          <div className="snp-wrap st2-layout">
            {/* LEFT: deck selector */}
            <div className="so-card st2-decks">
              <div className="so-card-h">Your Decks</div>
              {decks.map((d) => (
                <button key={d.deckId} className={"st2-deck" + (d.deckId === deckId ? " on" : "")} onClick={() => setDeckId(d.deckId)}>
                  <span className="st2-deck-art" style={{ background: `linear-gradient(160deg, ${leaderColorOf(d.leaderId)}, #0a0f17)` }}>
                    {leaderImageOf(d.leaderId) && <img src={leaderImageOf(d.leaderId)!} alt="" loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                  </span>
                  <span className="st2-deck-main">
                    <div className="st2-deck-name">{d.name}</div>
                    <div className="st2-deck-sub">{d.leaderName || leaderNameOf(d.leaderId)} · {d.games} games</div>
                  </span>
                </button>
              ))}
            </div>

            {/* RIGHT: stats for the selected deck */}
            <div className="st2-content" key={deckId}>
              <div className="st-overview">
                <div className="st-kpi">
                  <div className="glow" />
                  <div className="st-kpi-lbl">Overall Win Rate</div>
                  <div className={"st-kpi-val " + (overall != null && overall >= 50 ? "green" : "")}>{showPct(overall)}</div>
                  <div className="st-kpi-sub">{deck?.wins}W – {deck ? deck.games - deck.wins : 0}L</div>
                </div>
                <div className="st-kpi">
                  <div className="glow" />
                  <div className="st-kpi-lbl">WR going 1st</div>
                  <div className={"st-kpi-val " + (wr1 != null && wr1 >= 50 ? "green" : "")}>{showPct(wr1)}</div>
                  <div className="st-kpi-sub">{deck?.games1 || 0} games on the play</div>
                </div>
                <div className="st-kpi">
                  <div className="glow" />
                  <div className="st-kpi-lbl">WR going 2nd</div>
                  <div className={"st-kpi-val " + (wr2 != null && wr2 >= 50 ? "green" : "")}>{showPct(wr2)}</div>
                  <div className="st-kpi-sub">{deck?.games2 || 0} games on the draw</div>
                </div>
              </div>

              <div className="so-card">
                <div className="so-card-h"><span>Win rate vs each leader</span></div>
                {matchups.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)" }}>No matches recorded for this deck yet.</div>
                ) : (
                  <div className="st2-mu-wrap">
                    {hasOverflow && (
                      <button className="st2-arrow" onClick={() => scrollTrack(-1)} disabled={!over.left} aria-label="Scroll left">‹</button>
                    )}
                    <div className="st2-mu-track" ref={trackRef} onScroll={updateArrows}>
                      {matchups.map((m) => (
                        <div className="st2-mu" key={m.id}>
                          <div className="st2-mu-art" style={{ background: `linear-gradient(160deg, ${m.color}, #0a0f17)` }}>
                            {m.image
                              ? <img src={m.image} alt={m.name} loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                              : <span>{m.name[0]}</span>}
                          </div>
                          <div className="st2-mu-name">{m.name}</div>
                          <div className="st2-mu-wrs">
                            <div className="st2-mu-wr"><span className="lbl">WR 1st</span><b className={good(m.wr1)}>{showPct(m.wr1)}</b></div>
                            <div className="st2-mu-wr"><span className="lbl">WR 2nd</span><b className={good(m.wr2)}>{showPct(m.wr2)}</b></div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {hasOverflow && (
                      <button className="st2-arrow" onClick={() => scrollTrack(1)} disabled={!over.right} aria-label="Scroll right">›</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <Dock />
    </div>
  );
}
