import { Fragment, useEffect, useMemo, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type DirectoryUser, type FollowState, type ProfileStats } from "../../lib/api";
import { loadCardsById, cardColorHex, type Card } from "../cards/cardsDb";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { Header, Dock, Ico, LeaderArt, fmtDate } from "./ProfilePages";
import { BountyChart } from "../stats/BountyChart";
import { TierBadge, CountryTag, WinRate, WinRateBar } from "../stats/StatBits";
import { formatBounty, formatBountyDelta, seasonLabel, showPct, countryName, timeAgo } from "../stats/format";
import { PixelScene } from "../pixel/PixelScene";
import "../home/home.css";
import "./profiles.css";
import "../social/social.css";
import "../stats/stats.css";
import { PixelIcon } from "../pixel/PixelIcon";

/* Profile Viewer — a captain's full dossier: season Bounty + rank + tier, the
   Bounty chart (this season or an archived one), record with first/second
   split and streaks, a per-leader table that opens into matchups, recent games
   with Bounty change, past seasons, decks and bio. Data: /api/profiles/:u and
   /api/profiles/:u/stats (server/stats). */

interface ProfileData {
  user: { username: string; displayName: string; role: string; createdAt: number };
  profile: { bio: string; avatarColor: string; favoriteLeader: string | null; supporter: boolean; country: string; wins: number; losses: number };
  decks: { id: string; name: string; leaderId: string | null; leaderName: string; count: number; format: string; fav: boolean; wins: number; losses: number }[];
  social: FollowState;
}

export function ProfileViewer() {
  const setView = useUiStore((s) => s.setView);
  const openProfile = useUiStore((s) => s.openProfile);
  const viewingUsername = useUiStore((s) => s.viewingUsername);
  const openMessagesWith = useUiStore((s) => s.openMessagesWith);
  const me = useAuthStore((s) => s.user);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [username, setUsername] = useState("");
  const [data, setData] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [season, setSeason] = useState<string>("current");
  const [openLeader, setOpenLeader] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.directory(), loadCardsById()])
      .then(([d, m]) => {
        setDir(d.users);
        setCards(m);
        setUsername(viewingUsername || me?.username || d.users[0]?.username || "");
      })
      .catch(() => {});
  }, [me, viewingUsername]);

  useEffect(() => {
    if (!username) return;
    setData(null);
    setStats(null);
    setSeason("current");
    setOpenLeader(null);
    api.profileOf(username).then((d) => setData(d as ProfileData)).catch(() => setData(null));
    api.profileStats(username).then(setStats).catch(() => setStats(null));
  }, [username]);

  const card = (id: string | null | undefined) => (id && cards ? cards.get(id) || null : null);
  const nameOf = (id: string | null | undefined) => card(id)?.name || id || "—";
  const colorOf = (id: string | null | undefined) => { const c = card(id); return c ? cardColorHex(c) : "#3a4a5e"; };

  const favCard = card(data?.profile.favoriteLeader);
  const isSelf = data?.user.username === me?.username;
  const ladder = stats?.ladder || null;
  const sum = stats?.summary;

  const chart = useMemo(() => {
    if (!ladder) return { label: "", points: [] as { t: number; bounty: number }[] };
    if (season === "current") return { label: seasonLabel(stats!.season), points: ladder.history };
    const s = ladder.pastSeasons.find((x) => x.season === season);
    return { label: s ? seasonLabel(s.season) : "", points: s?.history || [] };
  }, [ladder, season, stats]);

  const toggleFollow = async () => {
    if (!data || followBusy) return;
    setFollowBusy(true);
    try {
      const { social } = data.social.isFollowing ? await api.unfollow(data.user.username) : await api.follow(data.user.username);
      setData({ ...data, social });
    } finally {
      setFollowBusy(false);
    }
  };

  const streakText = (n: number) => (n > 0 ? `${n}W` : n < 0 ? `${-n}L` : "—");

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
            {/* ---------- LEFT: identity ---------- */}
            <div className="pv-left">
              <div className="snp-frame pv-portrait">
                <div className="snp-screen">
                  <LeaderArt card={favCard} fallbackName={data.user.displayName} color={data.profile.avatarColor} />
                  <div className="snp-screen-scan" />
                </div>
              </div>
              <div className="pv-id">
                <div className="pv-username">{data.user.displayName}</div>
                <div className="pv2-handle">
                  @{data.user.username}
                  {data.profile.country && <> · <CountryTag code={data.profile.country} /> {countryName(data.profile.country)}</>}
                </div>
                <div className="pv-badges">
                  {ladder && <TierBadge tier={ladder.tier} provisional={ladder.provisional} />}
                  {data.profile.supporter && <span className="pv-badge gold"><PixelIcon name="star" size={12} /> Supporter</span>}
                  {data.user.role === "admin" && <span className="pv-badge gold"><PixelIcon name="anchor" size={12} /> Admin</span>}
                  {ladder?.pastSeasons.some((s) => s.rank === 1) && <span className="pv-badge gold"><PixelIcon name="crown" size={12} /> Season champion</span>}
                </div>
                <div className="pv2-follow">
                  <span><b>{data.social.followers}</b> followers</span>
                  <span><b>{data.social.following}</b> following</span>
                </div>
              </div>
              <div className="pv-actions pv2-actions">
                {isSelf ? (
                  <button className="pv-follow" onClick={() => setView("edit-profile")}>
                    <Ico n="edit" size={18} /> Edit my profile
                  </button>
                ) : (
                  <>
                    <button className={"pv-follow" + (data.social.isFollowing ? " following" : "")} onClick={toggleFollow} disabled={followBusy}>
                      <Ico n={data.social.isFollowing ? "check" : "follow"} size={18} /> {data.social.isFollowing ? "Following" : "Follow"}
                    </button>
                    <button className="sn-btn-ghost" onClick={() => openMessagesWith(data.user.username)}>
                      <Ico n="chat" size={16} /> Message
                    </button>
                  </>
                )}
                <button className="sn-btn-ghost" onClick={() => setView("rankings")}>
                  <Ico n="play" size={16} /> Leaderboard
                </button>
              </div>
              <dl className="pv-meta pv2-meta">
                <dt>Registered</dt>
                <dd>{fmtDate(data.user.createdAt)}</dd>
                <dt>First game</dt>
                <dd>{sum?.firstMatchAt ? fmtDate(sum.firstMatchAt) : "—"}</dd>
                <dt>Last game</dt>
                <dd>{timeAgo(ladder?.lastMatchAt ?? null)}</dd>
                <dt>Favorite</dt>
                <dd>{favCard ? favCard.name : "—"}</dd>
              </dl>
            </div>

            {/* ---------- RIGHT: numbers ---------- */}
            <div className="pv-right">
              {!stats ? (
                <div className="so-card" style={{ padding: 30, color: "var(--muted)", textAlign: "center" }}>Reading the logbook…</div>
              ) : (
                <>
                  {/* Bounty strip */}
                  <div className="st-overview pv2-kpis">
                    <div className="st-kpi">
                      <div className="st-kpi-lbl">Bounty · {seasonLabel(stats.season)}</div>
                      <div className="st-kpi-val gold">{ladder ? formatBounty(ladder.bounty) : "—"}{ladder?.provisional && <span className="pv2-q" title="Provisional: still placing">?</span>}</div>
                      <div className="st-kpi-sub">
                        {ladder?.rank ? `Rank #${ladder.rank}` : ladder?.provisional ? "Placing — not ranked yet" : "Not ranked this season"}
                      </div>
                    </div>
                    <div className="st-kpi">
                      <div className="st-kpi-lbl">Season peak</div>
                      <div className="st-kpi-val">{ladder ? formatBounty(ladder.peakBounty) : "—"}</div>
                      <div className="st-kpi-sub">All-time {ladder ? formatBounty(ladder.allTimePeakBounty) : "—"}</div>
                    </div>
                    <div className="st-kpi">
                      <div className="st-kpi-lbl">Season record</div>
                      <div className="st-kpi-val">{ladder ? <><span className="win-c">{ladder.wins}</span>–<span className="loss-c">{ladder.losses}</span></> : "—"}</div>
                      <div className="st-kpi-sub">{ladder?.games ? `${showPct(ladder.winRate)} WR · ${ladder.games} games` : "No games this season"}</div>
                    </div>
                    <div className="st-kpi">
                      <div className="st-kpi-lbl">Streak</div>
                      <div className={"st-kpi-val " + ((ladder?.streak ?? 0) > 0 ? "green" : "")}>{streakText(ladder?.streak ?? 0)}</div>
                      <div className="st-kpi-sub">Best {ladder?.bestStreak ?? 0} wins in a row</div>
                    </div>
                  </div>

                  {/* Bounty chart */}
                  <div className="so-card">
                    <div className="so-card-h pv2-cardh">
                      <span>Bounty · {chart.label}</span>
                      {ladder && ladder.pastSeasons.length > 0 && (
                        <span className="snp-select pv2-season">
                          <select value={season} onChange={(e) => setSeason(e.target.value)}>
                            <option value="current">{seasonLabel(stats.season)} (current)</option>
                            {ladder.pastSeasons.map((s) => (
                              <option key={s.season} value={s.season}>{seasonLabel(s.season)}</option>
                            ))}
                          </select>
                        </span>
                      )}
                    </div>
                    <div style={{ padding: "8px 10px 6px" }}>
                      <BountyChart points={chart.points} />
                    </div>
                  </div>

                  {/* all-time record */}
                  {sum && (
                    <div className="so-card">
                      <div className="so-card-h">All-time record</div>
                      <div className="pv2-rec">
                        <div><span className="k">Games</span><b>{sum.games}</b><small>{sum.last30Days} in the last 30 days</small></div>
                        <div><span className="k">Win rate</span><WinRate rate={sum.winRate} games={sum.games} ci={sum.ci} /><small>{sum.ci ? `95% range ${showPct(sum.ci[0])}–${showPct(sum.ci[1])}` : ""}</small></div>
                        <div><span className="k">Going 1st</span><WinRate rate={sum.winRate1} games={sum.games1} /><small>{sum.wins1}W – {sum.games1 - sum.wins1}L</small></div>
                        <div><span className="k">Going 2nd</span><WinRate rate={sum.winRate2} games={sum.games2} /><small>{sum.wins2}W – {sum.games2 - sum.wins2}L</small></div>
                      </div>
                    </div>
                  )}

                  {/* per leader */}
                  <div className="so-card">
                    <div className="so-card-h">Leaders played <span className="sx-note" style={{ marginLeft: "auto" }}>click a leader for its matchups</span></div>
                    {stats.leaders.length === 0 ? (
                      <div className="sx-chart-empty">No games yet.</div>
                    ) : (
                      <div className="pv2-table">
                        <div className="pv2-tr head"><span>Leader</span><span className="ar">Games</span><span>Win rate</span><span className="hide-s">95% range</span><span className="ar hide-s">1st</span><span className="ar hide-s">2nd</span></div>
                        {stats.leaders.map((l) => (
                          <Fragment key={l.leaderId}>
                            <button className={"pv2-tr row" + (openLeader === l.leaderId ? " open" : "")} onClick={() => setOpenLeader(openLeader === l.leaderId ? null : l.leaderId)}>
                              <span className="pv2-leader">
                                <LeaderAvatar name={nameOf(l.leaderId)} color={colorOf(l.leaderId)} image={card(l.leaderId)?.image} size={34} />
                                <span className="pv2-lname" title={l.leaderId}>{nameOf(l.leaderId)}</span>
                              </span>
                              <span className="ar mono">{l.games}</span>
                              <WinRate rate={l.winRate} games={l.games} ci={l.ci} />
                              <span className="hide-s"><WinRateBar rate={l.winRate} ci={l.ci} /></span>
                              <span className="ar hide-s"><WinRate rate={l.winRate1} games={l.games1} colored={false} /></span>
                              <span className="ar hide-s"><WinRate rate={l.winRate2} games={l.games2} colored={false} /></span>
                            </button>
                            {openLeader === l.leaderId && l.matchups.map((m) => (
                              <div className="pv2-tr sub" key={m.oppLeaderId}>
                                <span className="pv2-leader">
                                  <span className="pv2-vs">vs</span>
                                  <LeaderAvatar name={nameOf(m.oppLeaderId)} color={colorOf(m.oppLeaderId)} image={card(m.oppLeaderId)?.image} size={26} />
                                  <span className="pv2-lname" title={m.oppLeaderId}>{nameOf(m.oppLeaderId)}</span>
                                </span>
                                <span className="ar mono">{m.games}</span>
                                <WinRate rate={m.winRate} games={m.games} ci={m.ci} />
                                <span className="hide-s"><WinRateBar rate={m.winRate} ci={m.ci} /></span>
                                <span className="ar hide-s"><WinRate rate={m.winRate1} games={m.games1} colored={false} /></span>
                                <span className="ar hide-s"><WinRate rate={m.winRate2} games={m.games2} colored={false} /></span>
                              </div>
                            ))}
                          </Fragment>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* recent games */}
                  <div className="so-card">
                    <div className="so-card-h">Recent games</div>
                    {stats.recent.length === 0 ? (
                      <div className="sx-chart-empty">No games yet.</div>
                    ) : (
                      <div className="pv2-recent">
                        {stats.recent.map((g) => (
                          <div className="pv2-game" key={g.id}>
                            <span className={"pv2-res " + g.result}>{g.result === "win" ? "W" : "L"}</span>
                            <span className="pv2-matchup">
                              <LeaderAvatar name={nameOf(g.myLeaderId)} color={colorOf(g.myLeaderId)} image={card(g.myLeaderId)?.image} size={28} />
                              <span className="pv2-vs">vs</span>
                              <LeaderAvatar name={nameOf(g.oppLeaderId)} color={colorOf(g.oppLeaderId)} image={card(g.oppLeaderId)?.image} size={28} />
                              <span className="pv2-g-names">
                                <b>{nameOf(g.oppLeaderId)}</b>
                                {g.opponent.username ? (
                                  <button className="pv2-link" onClick={() => openProfile(g.opponent.username)}>{g.opponent.displayName}</button>
                                ) : (
                                  <small>{g.opponent.displayName}</small>
                                )}
                              </span>
                            </span>
                            <span className="pv2-first">{g.onPlay ? "1st" : "2nd"}</span>
                            <span className={"sx-delta " + ((g.bountyDelta ?? 0) >= 0 ? "up" : "down")}>{g.bountyDelta == null ? "" : formatBountyDelta(g.bountyDelta)}</span>
                            <span className="pv2-when">{timeAgo(g.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* past seasons */}
                  {ladder && ladder.pastSeasons.length > 0 && (
                    <div className="so-card">
                      <div className="so-card-h">Past seasons</div>
                      <div className="pv2-table">
                        <div className="pv2-tr head seasons"><span>Season</span><span>Tier</span><span className="ar">Rank</span><span className="ar">Final</span><span className="ar">Peak</span><span className="ar">Record</span></div>
                        {ladder.pastSeasons.map((s) => (
                          <div className="pv2-tr seasons" key={s.season}>
                            <span>{seasonLabel(s.season)}</span>
                            <span>{s.tier ? <TierBadge tier={s.tier} /> : <span className="sx-note">unranked</span>}</span>
                            <span className="ar mono">{s.rank ? `#${s.rank}` : "—"}</span>
                            <span className="ar mono">{formatBounty(s.bounty)}</span>
                            <span className="ar mono">{formatBounty(s.peakBounty)}</span>
                            <span className="ar mono">{s.wins}–{s.games - s.wins}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <div className="pv-bio-h">Profile</div>
                <div className="pv-bio">{data.profile.bio || "No bio yet."}</div>
              </div>

              <div>
                <div className="pv-bio-h">Decks ({data.decks.length})</div>
                <div className="pv-decks">
                  {data.decks.length === 0 && <div className="pv-decks-empty">No decks yet.</div>}
                  {data.decks.map((d) => {
                    const lc = card(d.leaderId);
                    return (
                      <div className="pv-deck" key={d.id} style={{ ["--cc" as string]: lc ? cardColorHex(lc) : "#3a4a5e" }}>
                        {lc?.image
                          ? <img className="pv-deck-art" src={lc.image} alt="" loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                          : <span className="pv-deck-art ph" />}
                        <span className="pv-deck-info">
                          <b>{d.name}{d.fav && <span className="pv-deck-fav"><PixelIcon name="star" size={12} /></span>}</b>
                          <small>{d.leaderName || lc?.name || "—"} · {d.count}/50 · {d.format || "—"}</small>
                        </span>
                        <span className="pv-deck-wl"><b className="w">{d.wins}W</b> · <b className="l">{d.losses}L</b></span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <Dock />
    </div>
  );
}
