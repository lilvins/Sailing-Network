/* ===========================================================
   Sailing Network — Profile Viewer / My Profile / Duel Records
   Exports window.SNPages = { ProfileViewer, MyProfile, DuelRecords }
   =========================================================== */
const { useState, useMemo } = React;

/* ---------- icons ---------- */
const SNP_ICON = {
  back: "M19 12H5M12 19l-7-7 7-7",
  camera: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z",
  follow: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M19 8v6M22 11h-6",
  check: "M20 6L9 17l-5-5",
  save: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z",
  help: "M12 17h.01M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 21a9 9 0 100-18 9 9 0 000 18z",
  play: "M5 3l14 9-14 9V3z",
  exit: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  chat: "M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  friends: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"
};
function I({ n, size = 20, sw = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={SNP_ICON[n]}></path></svg>);
}

/* ---------- color identity for One Piece leaders ---------- */
const HUE = { R: "#c0392b", G: "#1f8a5b", B: "#2a6fdb", P: "#7a3fa0", K: "#2c3138", Y: "#caa023" };
const LEADERS = [
["Shanks", "R"], ["Luffy", "P"], ["Luffy", "K"], ["Uta", "G"], ["Doflamingo", "B"], ["Katakuri", "Y"],
["Zoro", "G"], ["Law", "R"], ["Sakazuki", "B"], ["Hancock", "P"], ["Crocodile", "K"], ["Kaido", "P"],
["Big Mom", "Y"], ["Whitebeard", "B"], ["Ace", "R"], ["Sabo", "G"], ["Nami", "B"], ["Robin", "P"],
["Chopper", "R"], ["Franky", "B"], ["Brook", "K"], ["Jinbe", "B"], ["Usopp", "G"], ["Sanji", "Y"],
["Yamato", "Y"], ["Smoker", "K"], ["Marco", "B"], ["Reiju", "P"], ["Perona", "P"], ["Carrot", "Y"],
["Bonney", "R"], ["Kid", "P"], ["Killer", "K"], ["Garp", "B"], ["Mihawk", "K"], ["Boa", "R"]];

function leaderColor(h) {return HUE[h] || "#3a4a5e";}

/* ---------- placeholder avatar (gradient + leader name) ---------- */
function PH({ name, hue, big }) {
  const c = leaderColor(hue);
  return (
    <div className="snp-ph">
      <div className="ph-glow" style={{ background: `radial-gradient(120% 90% at 50% 18%, ${c}cc, ${c}55 45%, #0a0f17 86%)` }}></div>
      <div className="ph-emblem">{name[0]}</div>
      <div className="ph-check"><I n="check" size={12} /></div>
      {big !== false && <div className="ph-name">{name}</div>}
    </div>);
}

/* ---------- shared header ---------- */
function Header({ title, sub, right }) {
  return (
    <header className="snp-head">
      <a className="snp-back" href="Home.html" title="Back to Main Menu"><I n="back" /></a>
      <div className="snp-head-title">
        <h1>{title}</h1>
        {sub && <span className="sn-kicker">{sub}</span>}
      </div>
      <div className="snp-head-r">{right}</div>
    </header>);
}

function Dock() {
  return (
    <div className="snp-dock">
      <a className="snp-iconbtn" href="#" title="Messages"><I n="chat" /><span className="snp-dock-badge">3</span></a>
      <a className="snp-iconbtn" href="#" title="Friends online"><I n="friends" /></a>
    </div>);
}

function Select({ value, onChange, options }) {
  return (
    <span className="snp-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>);
}

/* =================================================================
   PROFILE VIEWER (read-only)
   ================================================================= */
function ProfileViewer() {
  const [following, setFollowing] = useState(false);
  const [art, setArt] = useState(0);
  const arts = [["Shanks", "R"], ["Mihawk", "K"], ["Buggy", "R"]];
  const cur = arts[art];
  return (
    <div className="snp">
      <Header title="Profile Viewer" sub="Captain dossier"
      right={<a className="snp-iconbtn" href="My Profile.html" title="Edit my profile"><I n="edit" /></a>} />
      <div className="snp-body"><div className="snp-wrap pv-grid">
        <div className="pv-left">
          <div className="snp-frame pv-portrait">
            <div className="snp-screen">
              <PH name={cur[0]} hue={cur[1]} />
              <image-slot id="pv-portrait" shape="rect" placeholder="Drop captain art" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}></image-slot>
              <div className="snp-screen-scan"></div>
            </div>
          </div>
          <div className="pv-id">
            <div className="pv-username">ShanksRedHair</div>
            <div className="pv-badges">
              <span className="pv-badge"><span className="sn-livedot"></span> Yonko Tier</span>
              <span className="pv-badge gold">★ Supporter</span>
            </div>
          </div>
        </div>

        <div className="pv-right">
          <dl className="pv-meta">
            <dt>Status</dt><dd className="online">Online</dd>
            <dt>Last Seen</dt><dd>Now</dd>
            <dt>Registered</dt><dd>Feb 02, 2026, 5:24 AM</dd>
            <dt>Favorite Leader</dt><dd>Red Shanks (OP01-120)</dd>
          </dl>

          <div className="pv-stats">
            <div className="pv-stats-h">
              <span className="lead">Standard</span><span className="col">Match</span><span className="col">Single</span>
            </div>
            {[
              ["Ranking", <span className="v calc">#214</span>, <span className="v calc">#380</span>],
              ["Rating / Exp", <span className="v mono">215 / 451</span>, <span className="v mono">100 / 0</span>],
              ["Wins", <span className="v win mono">93</span>, <span className="v win mono">0</span>],
              ["Losses", <span className="v loss mono">57</span>, <span className="v loss mono">0</span>],
              ["Draws", <span className="v mono">0</span>, <span className="v mono">0</span>]].
              map((r, i) =>
              <div className="pv-srow" key={i}>
                <span className="k">{r[0]}</span>{r[1]}{r[2]}
              </div>
              )}
          </div>

          <div>
            <div className="pv-bio-h">Profile</div>
            <div className="pv-bio">BAM BAM BAM
</div>
          </div>

          <div className="pv-actions">
            <button className={"pv-follow" + (following ? " following" : "")} onClick={() => setFollowing((v) => !v)}>
              <I n="follow" size={18} /> {following ? "Following" : "Follow User"}
            </button>
            <a className="sn-btn-ghost" href="Duel Records.html"><I n="play" size={16} /> View Records</a>
          </div>
        </div>
      </div></div>
      <Dock />
    </div>);}

/* =================================================================
   MY PROFILE (editable)
   ================================================================= */
function MyProfile() {
  const [sel, setSel] = useState(2);
  const [bio, setBio] = useState("SUIIIII — Purple Luffy enjoyer. Building toward Yonko tier. Hit me for ranked.");
  const [saved, setSaved] = useState(false);
  const cur = LEADERS[sel];
  const save = () => {setSaved(true);setTimeout(() => setSaved(false), 1600);};
  const cycle = (d) => setSel((s) => (s + d + LEADERS.length) % LEADERS.length);
  return (
    <div className="snp">
      <Header title="My Profile" sub="Customize your captain"
      right={<a className="snp-iconbtn" href="Profile Viewer.html" title="View as public"><I n="follow" /></a>} />
      <div className="snp-body"><div className="snp-wrap mp-grid">
        {/* portrait + carousel */}
        <div>
          <div className="snp-frame mp-portrait">
            <button className="snp-carousel-btn prev" onClick={() => cycle(-1)} aria-label="Previous"><I n="back" size={16} /></button>
            <button className="snp-carousel-btn next" onClick={() => cycle(1)} aria-label="Next"><span style={{ transform: "rotate(180deg)", display: "flex" }}><I n="back" size={16} /></span></button>
            <div className="snp-screen">
              <PH name={cur[0]} hue={cur[1]} />
              <image-slot id="mp-portrait" shape="rect" placeholder="Drop your portrait" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}></image-slot>
            </div>
          </div>
          <div className="mp-portrait-cap">Captain_SS</div>
          <div className="mp-portrait-sub">Avatar: {cur[0]}</div>
        </div>

        {/* avatar picker + bio */}
        <div className="mp-mid">
          <div className="mp-pick-h">
            <span>Choose Avatar</span>
            <span className="mp-charcount">{LEADERS.length} unlocked</span>
          </div>
          <div className="mp-grid-av">
            {LEADERS.map((l, i) =>
              <button key={i} className={"mp-av" + (i === sel ? " on" : "")} onClick={() => setSel(i)} title={l[0]}>
                <PH name={l[0]} hue={l[1]} big={false} />
                <span className="ph-name">{l[0]}</span>
              </button>
              )}
          </div>

          <div className="mp-bio-h">Profile</div>
          <textarea className="mp-bio-box" value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} placeholder="Tell other captains about yourself…"></textarea>
          <div className="mp-bio-foot">
            <span className="mp-charcount">{bio.length}/280</span>
            <button className="sn-btn-primary mp-save" onClick={save}>
              <I n={saved ? "check" : "save"} size={18} /> {saved ? "Saved!" : "Save Profile"}
            </button>
          </div>
        </div>

        {/* supporter side */}
        <div className="mp-side">
          <div className="mp-supporter">
            <div className="glow"></div>
            <div className="mp-supporter-k">Supporter Pass</div>
            <div className="mp-supporter-h">Hoist the Colors</div>
            <div className="mp-supporter-p">Unlock every captain avatar, animated frames, and priority matchmaking. Support keeps the seas open.</div>
            <button className="mp-redeem"><I n="gift" size={16} /> Redeem Donation</button>
          </div>
          <div className="mp-help"><I n="help" size={16} /> How avatars & donations work</div>
        </div>
      </div></div>
      <Dock />
    </div>);
}

/* =================================================================
   DUEL RECORDS (table)
   ================================================================= */
const RECORDS = [
{ opp: "vkt_fgnt", hue: "R", re: "99 / 0", fmt: "OP16", res: "WIN", pts: 15, nr: "215 / 451", date: "2h ago" },
{ opp: "= D", hue: "G", re: "119 / 716", fmt: "OP16", res: "LOSE", pts: -6, nr: "200 / 447", date: "5h ago" },
{ opp: "GameSlayer", hue: "Y", re: "116 / 714", fmt: "OP15", res: "LOSE", pts: -6, nr: "206 / 447", date: "7h ago" },
{ opp: "Dilemmaygo@YT", hue: "P", re: "219 / 478", fmt: "OP16", res: "LOSE", pts: -5, nr: "212 / 443", date: "Yesterday" },
{ opp: "Concezio", hue: "P", re: "217 / 2764", fmt: "OP16", res: "WIN", pts: 22, nr: "217 / 443", date: "Yesterday" },
{ opp: "Steincraft", hue: "R", re: "131 / 2503", fmt: "OP15", res: "WIN", pts: 17, nr: "195 / 441", date: "Yesterday" },
{ opp: "PBS", hue: "K", re: "116 / 8730", fmt: "OP16", res: "WIN", pts: 23, nr: "178 / 437", date: "2 days ago" },
{ opp: "Carlos22", hue: "B", re: "212 / 37", fmt: "East Blue", res: "WIN", pts: 19, nr: "155 / 433", date: "2 days ago" },
{ opp: "M2h", hue: "G", re: "98 / 972", fmt: "OP16", res: "WIN", pts: 20, nr: "136 / 431", date: "3 days ago" },
{ opp: "Yuruloki", hue: "Y", re: "242 / 1935", fmt: "OP15", res: "WIN", pts: 17, nr: "116 / 429", date: "3 days ago" }];

function DuelRecords() {
  const [q, setQ] = useState("");
  const [fmt, setFmt] = useState("All Formats");
  const [season, setSeason] = useState("Current Season");
  const rows = useMemo(() => RECORDS.filter((r) =>
  (fmt === "All Formats" || r.fmt === fmt) && (
  !q || r.opp.toLowerCase().includes(q.toLowerCase()))), [q, fmt]);
  const wins = rows.filter((r) => r.res === "WIN").length;
  const losses = rows.filter((r) => r.res === "LOSE").length;
  return (
    <div className="snp">
      <Header title="Duel Records" sub="Match history & replays"
      right={<div className="rec-summary">
          <span className="rec-chip w">Wins <span className="n">{wins}</span></span>
          <span className="rec-chip l">Losses <span className="n">{losses}</span></span>
        </div>} />
      <div className="snp-body"><div className="snp-wrap">
        <div className="rec-toolbar">
          <Select value={fmt} onChange={setFmt} options={["All Formats", "OP16", "OP15", "East Blue"]} />
          <Select value={season} onChange={setSeason} options={["Current Season", "Season 5", "Season 4", "All Time"]} />
          <div className="spacer"></div>
          <div className="rec-search">
            <I n="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter opponents…" />
          </div>
        </div>

        <div className="rec-table">
          <div className="rec-head">
            <span></span><span>Opponent</span><span>Rating / Exp</span><span>Format</span>
            <span>Result</span><span className="ar">Points</span><span className="ar">New Rating</span>
            <span>Date</span><span className="ar">Replay</span>
          </div>
          {rows.map((r, i) =>
            <div className="rec-row" key={i}>
              <Avatar2 name={r.opp} hue={r.hue} />
              <div className="rec-opp"><span className="name">{r.opp}</span></div>
              <span className="rec-val">{r.re}</span>
              <span><span className="rec-fmt-pill">{r.fmt}</span></span>
              <span className={"rec-res " + (r.res === "WIN" ? "win" : "lose")}>{r.res}</span>
              <span className={"rec-pts " + (r.pts >= 0 ? "up" : "down")}>{r.pts >= 0 ? "+" : ""}{r.pts}</span>
              <span className="rec-new">{r.nr}</span>
              <span className="rec-date">{r.date}</span>
              <a className="rec-replay" href="#"><I n="play" size={13} /> Replay</a>
            </div>
            )}
          {rows.length === 0 && <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>No duels match your filter.</div>}
        </div>

        <div className="rec-foot">
          <a className="rec-exit" href="Home.html"><I n="exit" size={16} /> Exit to Main Menu</a>
          <span className="mp-charcount">Showing {rows.length} of {RECORDS.length} recent duels</span>
        </div>
      </div></div>
      <Dock />
    </div>);
}
/* tiny avatar for table rows */
function Avatar2({ name, hue }) {
  const c = leaderColor(hue);
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, overflow: "hidden", flex: "0 0 auto",
      background: `linear-gradient(150deg, ${c}, #0d1420)`, boxShadow: `0 0 0 2px rgba(227,178,76,0.35)` }}>
      <div className="snp-ph"><div className="ph-emblem" style={{ fontSize: 22, transform: "translate(-50%,-50%)" }}>{name[0].toUpperCase()}</div></div>
    </div>);
}

/* =================================================================
   RANKINGS (ranked-season leaderboard)
   ================================================================= */
const RANKINGS = [
  { name:"flaming_ice",  hue:"R", elo:2480, w:412, l:88,  lead:["Shanks","R"],     streak:9 },
  { name:"calmaperdioo",   hue:"P", elo:2391, w:377, l:102, lead:["Katakuri","Y"],   streak:3 },
  { name:"poey_dw",      hue:"K", elo:2350, w:401, l:140, lead:["Luffy","K"],      streak:-1 },
  { name:"NavigatorNami",  hue:"B", elo:2288, w:298, l:96,  lead:["Doflamingo","B"], streak:5 },
  { name:"SwordHawk",      hue:"K", elo:2210, w:265, l:110, lead:["Zoro","G"],       streak:2 },
  { name:"Captain_SS",     hue:"P", elo:2184, w:312, l:226, lead:["Luffy","P"],      streak:4, you:true },
  { name:"FrankyShip",     hue:"B", elo:2090, w:241, l:158, lead:["Law","R"],        streak:-2 },
  { name:"BrookSoul",      hue:"P", elo:2031, w:199, l:147, lead:["Kid","P"],        streak:1 },
  { name:"RogerPirate",    hue:"R", elo:1990, w:288, l:240, lead:["Ace","R"],        streak:6 },
  { name:"ZoroSan",        hue:"G", elo:1942, w:176, l:131, lead:["Zoro","G"],       streak:-1 },
  { name:"UsoppKing",      hue:"G", elo:1888, w:154, l:140, lead:["Uta","G"],        streak:2 },
  { name:"YamatoOden",     hue:"Y", elo:1840, w:201, l:198, lead:["Yamato","Y"],     streak:3 },
];
function winRate(w, l) { return Math.round((w / Math.max(1, w + l)) * 100); }

function RankRow({ r }) {
  const wr = winRate(r.w, r.l);
  return (
    <div className={"rec-row rk-row" + (r.you ? " me" : "")}>
      <span className={"rk-rank r" + (r.rank <= 3 ? r.rank : "")}>{r.rank}</span>
      <div className="rec-opp">
        <Avatar2 name={r.name} hue={r.hue} />
        <span className="name">{r.name}{r.you && <span className="rk-youtag">YOU</span>}</span>
      </div>
      <span className="rk-lead">
        <span className="rk-leaddot" style={{ background: leaderColor(r.lead[1]) }}></span>{r.lead[0]}
      </span>
      <span className="rk-wr">
        <span className="rk-wr-bar"><span className="rk-wr-fill" style={{ width: wr + "%", background: wr >= 50 ? "linear-gradient(90deg,#1f8a5b,#46c98a)" : "linear-gradient(90deg,#9a3b34,#e26a62)" }}></span></span>
        <span className="rk-wr-num">{wr}%</span>
      </span>
      <span className="rec-new">{r.elo}</span>
      <span className="rk-record"><b className="win">{r.w}</b> – <b className="loss">{r.l}</b></span>
      <span className={"rk-streak " + (r.streak >= 0 ? "up" : "down")}>{r.streak >= 0 ? "W" + r.streak : "L" + (-r.streak)}</span>
    </div>);
}

function Rankings() {
  const [q, setQ] = useState("");
  const [season, setSeason] = useState("Season 6 (Current)");
  const [region, setRegion] = useState("Global");
  const ranked = useMemo(() =>
    [...RANKINGS].sort((a, b) => b.elo - a.elo).map((r, i) => ({ ...r, rank: i + 1 })), []);
  const rows = useMemo(() =>
    ranked.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())), [q, ranked]);
  const me = ranked.find((r) => r.you);
  return (
    <div className="snp">
      <Header title="Rankings" sub="Ranked season leaderboard"
        right={me && <div className="rk-myrank">
          <span className="rk-myrank-k">Your rank</span>
          <span className="rk-myrank-v">#{me.rank}</span>
        </div>} />
      <div className="snp-body"><div className="snp-wrap">
        {/* podium — top 3 */}
        <div className="rk-podium">
          {[ranked[1], ranked[0], ranked[2]].map((p, i) => (
            <div key={p.name} className={"rk-pod rk-pod-" + p.rank}>
              <div className="rk-pod-medal">{p.rank}</div>
              <div className="rk-pod-av"><Avatar2 name={p.name} hue={p.hue} /></div>
              <div className="rk-pod-name">{p.name}</div>
              <div className="rk-pod-elo">{p.elo} <span>ELO</span></div>
              <div className="rk-pod-meta">
                <span className="rk-pod-wr">{winRate(p.w, p.l)}% WR</span>
                <span className="rk-pod-lead"><span className="rk-leaddot" style={{ background: leaderColor(p.lead[1]) }}></span>{p.lead[0]}</span>
              </div>
            </div>
          ))}
        </div>

        {/* toolbar */}
        <div className="rec-toolbar">
          <Select value={season} onChange={setSeason} options={["Season 6 (Current)", "Season 5", "Season 4", "All Time"]} />
          <Select value={region} onChange={setRegion} options={["Global", "EN", "JP", "Friends"]} />
          <div className="spacer"></div>
          <div className="rec-search">
            <I n="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a captain…" />
          </div>
        </div>

        {/* pinned: your standing, always above the board */}
        {me &&
          <div className="rk-pinned-wrap">
            <div className="rk-pinned-label">Your standing</div>
            <div className="rec-table rk-pinned"><RankRow r={me} /></div>
          </div>}

        {/* leaderboard table */}
        <div className="rec-table">
          <div className="rec-head rk-head">
            <span className="ar">#</span><span>Captain</span><span>Most-Used Leader</span>
            <span>Season Win Rate</span><span className="ar">Rating</span><span className="ar">W – L</span><span className="ar">Streak</span>
          </div>
          {rows.map((r) => <RankRow key={r.name} r={r} />)}
          {rows.length === 0 && <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>No captains match your search.</div>}
        </div>

        <div className="rec-foot">
          <a className="rec-exit" href="Home.html"><I n="exit" size={16} /> Exit to Main Menu</a>
          <span className="mp-charcount">{ranked.length} ranked captains · updates live</span>
        </div>
      </div></div>
      <Dock />
    </div>);
}

window.SNPages = { ProfileViewer, MyProfile, DuelRecords, Rankings };