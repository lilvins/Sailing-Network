import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type Leaderboard, type LeaderboardEntry } from "../../lib/api";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { Header, Dock, Ico } from "./ProfilePages";
import { TierBadge, CountryTag, WinRate } from "../stats/StatBits";
import { formatBounty, seasonLabel, countryName, timeAgo, showPct, TIER_COLOR } from "../stats/format";
import { PixelScene } from "../pixel/PixelScene";
import "../home/home.css";
import "./profiles.css";
import "../stats/stats.css";

/* Leaderboard — this season's ladder by Bounty (Glicko-2, server/stats).
   Filters: leader (players with 5+ games on it this season) and country.
   Every row opens the captain's profile. */

export function Rankings() {
  const setView = useUiStore((s) => s.setView);
  const openProfile = useUiStore((s) => s.openProfile);
  const me = useAuthStore((s) => s.user);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [allLeaders, setAllLeaders] = useState<string[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [leader, setLeader] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [rules, setRules] = useState(false);

  useEffect(() => {
    loadCardsById().then(setCards).catch(() => {});
  }, []);

  useEffect(() => {
    setBoard(null);
    api.leaderboard(500, { leader, country }).then((b) => {
      setBoard(b);
      // the leader filter offers every leader that shows up in an unfiltered board
      if (!leader && !country) {
        const ids = new Set<string>();
        b.leaders.forEach((r) => r.topLeaders.forEach((t) => ids.add(t.leaderId)));
        setAllLeaders([...ids]);
      }
    }).catch(() => setBoard(null));
  }, [leader, country]);

  const card = (id: string | null | undefined) => (id && cards ? cards.get(id) || null : null);
  const nameOf = (id: string | null | undefined) => card(id)?.name || id || "—";
  const colorOf = (id: string | null | undefined) => { const c = card(id); return c ? cardColorHex(c) : "#3a4a5e"; };

  const rows = useMemo(() => {
    const all = board?.leaders || [];
    const s = q.trim().toLowerCase();
    return s ? all.filter((r) => r.displayName.toLowerCase().includes(s) || r.username.toLowerCase().includes(s)) : all;
  }, [board, q]);
  const mine = board?.leaders.find((r) => r.username === me?.username) || null;
  const filtered = !!(leader || country);
  const podium = !filtered && !q && board && board.leaders.length >= 3 ? [board.leaders[1], board.leaders[0], board.leaders[2]] : [];
  const leaderOptions = useMemo(() => [...allLeaders].sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [allLeaders, cards]);

  const Row = ({ r }: { r: LeaderboardEntry }) => {
    const shown = leader ? null : r.topLeaders;
    return (
      <button className={"rec-row rk2-row" + (r.username === me?.username ? " me rk-row" : "")} onClick={() => openProfile(r.username)}>
        <span className={"rk-rank r" + (r.rank && r.rank <= 3 ? r.rank : "")}>{r.rank ?? "—"}</span>
        <div className="rec-opp">
          <LeaderAvatar name={r.displayName} color={colorOf(r.favoriteLeader)} image={card(r.favoriteLeader)?.image} size={42} />
          <span className="rk2-name">
            <span className="name">{r.displayName}{r.username === me?.username && <span className="rk-youtag">YOU</span>}</span>
            <small>@{r.username} {r.country && <CountryTag code={r.country} />}</small>
          </span>
        </div>
        <span><TierBadge tier={r.tier} /></span>
        <span className="rk2-bounty">{formatBounty(r.bounty)}</span>
        <span className="ar mono rk2-muted">{formatBounty(r.peakBounty)}</span>
        <span className="rk-record"><b className="win">{r.wins}</b> – <b className="loss">{r.losses}</b></span>
        <span>{leader && r.withLeader
          ? <WinRate rate={r.withLeader.winRate} games={r.withLeader.games} ci={r.withLeader.ci} />
          : <WinRate rate={r.winRate} games={r.games} />}</span>
        <span className="rk2-leaders">
          {shown
            ? shown.map((t) => (
                <span key={t.leaderId} title={`${nameOf(t.leaderId)} · ${t.games} games · ${showPct(t.winRate)}`}>
                  <LeaderAvatar name={nameOf(t.leaderId)} color={colorOf(t.leaderId)} image={card(t.leaderId)?.image} size={28} />
                </span>
              ))
            : <span className="sx-note">{r.withLeader?.games} games with it</span>}
        </span>
        <span className="ar rk2-muted">{timeAgo(r.lastMatchAt)}</span>
      </button>
    );
  };

  return (
    <div className="sn snp px">
      <PixelScene kind="sunset" />
      <Header
        title="Leaderboard"
        sub={board ? `Season ${seasonLabel(board.season)} · by Bounty` : "Season ladder"}
        hero="/assets/bg/sec-rankings.png"
        right={
          mine?.rank ? (
            <div className="rk-myrank">
              <span className="rk-myrank-k">Your rank</span>
              <span className="rk-myrank-v">#{mine.rank}</span>
            </div>
          ) : undefined
        }
      />
      <div className="snp-body">
        <div className="snp-wrap">
          {podium.length === 3 && (
            <div className="rk-podium">
              {podium.map((p) => (
                <button key={p.username} className={"rk-pod rk-pod-" + p.rank} onClick={() => openProfile(p.username)}>
                  <div className="rk-pod-medal">{p.rank}</div>
                  <div className="rk-pod-av">
                    <LeaderAvatar name={p.displayName} color={colorOf(p.favoriteLeader)} image={card(p.favoriteLeader)?.image} fill />
                  </div>
                  <div className="rk-pod-name">{p.displayName} <CountryTag code={p.country} /></div>
                  <div className="rk-pod-elo">{formatBounty(p.bounty)}</div>
                  <div className="rk-pod-meta">
                    <TierBadge tier={p.tier} />
                    <span className="rk-pod-wr">{showPct(p.winRate)} WR · {p.games} games</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* tier distribution */}
          {board && board.totalRanked > 0 && (
            <div className="rk2-tiers">
              <div className="rk2-tiers-bar">
                {board.tiers.filter((t) => t.players > 0).map((t) => (
                  <span key={t.id} style={{ flexGrow: t.players, background: TIER_COLOR[t.id] }} title={`${t.name}: ${t.players} captains (${t.share}%)`} />
                ))}
              </div>
              <div className="rk2-tiers-key">
                {board.tiers.map((t) => (
                  <span key={t.id}><i style={{ background: TIER_COLOR[t.id] }} />{t.name} <b>{t.share}%</b></span>
                ))}
                <button className="rk2-rules-btn" onClick={() => setRules((v) => !v)}>{rules ? "Hide" : "How the Bounty works"}</button>
              </div>
              {rules && (
                <div className="rk2-rules">
                  <p>Your <b>Bounty</b> is a Glicko-2 rating × {board.tierRules.berriesPerPoint.toLocaleString()} Berries. Beating a higher Bounty pays more than beating a lower one; the less sure the system is about you, the bigger each move.</p>
                  <p>New captains are <b>provisional</b> (shown with “?”) until the rating settles (RD ≤ {board.tierRules.provisionalRd}). You appear here after <b>{board.tierRules.minGames} games</b> in the season.</p>
                  <p>Seasons run one calendar month. At the start of a season every Bounty is pulled halfway back to ฿1.50B.</p>
                  <p>Tiers: {board.tierRules.tiers.map((t) => `${t.name} ${formatBounty(t.min * board.tierRules.berriesPerPoint)}+`).join(" · ")} · <b>{board.tierRules.topTier.name}</b> = #1.</p>
                </div>
              )}
            </div>
          )}

          <div className="rec-toolbar">
            <span className="snp-select">
              <select value={leader} onChange={(e) => setLeader(e.target.value)}>
                <option value="">All leaders</option>
                {leaderOptions.map((id) => <option key={id} value={id}>{nameOf(id)} ({id})</option>)}
              </select>
            </span>
            <span className="snp-select">
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">All countries</option>
                {(board?.countries || []).concat(country && !(board?.countries || []).includes(country) ? [country] : []).map((c) => (
                  <option key={c} value={c}>{countryName(c)}</option>
                ))}
              </select>
            </span>
            <div className="spacer" />
            <div className="rec-search">
              <Ico n="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a captain…" />
            </div>
          </div>

          {mine && !q && (
            <div className="rk-pinned-wrap">
              <div className="rk-pinned-label">Your standing</div>
              <div className="rec-table rk-pinned"><Row r={mine} /></div>
            </div>
          )}

          <div className="rec-table">
            <div className="rec-head rk2-row">
              <span className="ar">#</span>
              <span>Captain</span>
              <span>Tier</span>
              <span>Bounty</span>
              <span className="ar">Peak</span>
              <span className="ar">W – L</span>
              <span>{leader ? `WR with ${nameOf(leader)}` : "Win rate"}</span>
              <span>{leader ? "" : "Top leaders"}</span>
              <span className="ar">Last game</span>
            </div>
            {!board && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Reading the charts…</div>}
            {board && rows.map((r) => <Row key={r.username} r={r} />)}
            {board && rows.length === 0 && (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
                {filtered ? "No ranked captains match these filters." : "No ranked captains yet this season."}
              </div>
            )}
          </div>

          <div className="rec-foot">
            <button className="rec-exit" onClick={() => setView("home")}>
              <Ico n="exit" size={16} /> Exit to Main Menu
            </button>
            <span className="mp-charcount">{board ? `${rows.length} of ${board.totalRanked} ranked captains` : ""}</span>
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}
