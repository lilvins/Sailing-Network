/* ===========================================================
   Sailing Network — Deck Constructor
   Adapted from a Master-Duel-style 3-pane builder, One Piece TCG rules:
   1 Leader + 50-card Main Deck (max 4 copies) + fixed 10 DON!! deck.
   No crafting / dismantle / obtain / ownership — free simulator.
   Exports window.DeckBuilder
   =========================================================== */
const { useState, useMemo, useRef } = React;

/* ---------- icons (self-contained) ---------- */
const DB_ICON = {
  back:"M19 12H5M12 19l-7-7 7-7", search:"M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  edit:"M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  exit:"M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  chat:"M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  friends:"M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  plus:"M12 5v14M5 12h14", minus:"M5 12h14", trash:"M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
  save:"M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8",
  shuffle:"M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5", link:"M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  sort:"M3 6h18M6 12h12M10 18h4", sliders:"M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  cards:"M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4", star:"M12 2l3 7 7 .5-5.5 4.5L18 21l-6-4-6 4 1.5-7L2 9.5 9 9z",
  leader:"M5 16l-2-9 6 4 3-7 3 7 6-4-2 9zM5 20h14",
  lock:"M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4",
};
function I({ n, size=20, sw=1.9 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={DB_ICON[n]}></path></svg>;
}

/* ---------- dropdown (self-contained, styled by .snp-select) ---------- */
function Select({ value, onChange, options }) {
  return (
    <span className="snp-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>);
}

/* ---------- One Piece color identity ---------- */
const HUE = { R:"#c0392b", G:"#1f8a5b", B:"#2a6fdb", P:"#7a3fa0", K:"#2c3138", Y:"#caa023" };
const HUE_NAME = { R:"Red", G:"Green", B:"Blue", P:"Purple", K:"Black", Y:"Yellow" };
function hueColor(h){ return HUE[h] || "#3a4a5e"; }

/* ---------- card pool (believable OP TCG set) ----------
   t: L leader / C character / E event / S stage
   col: color, cost, pow (power, characters/leaders), cnt (counter), life (leader)
   tags: subtypes; fx: effect text; max copies (4 normal, 1 leader) */
let _cid = 0;
const C = (name, t, col, cost, pow, cnt, tags, fx, set) =>
  ({ id: ++_cid, name, t, col, cost, pow, cnt, tags, fx, set, max: t==="L"?1:4 });

const POOL = [
  // leaders
  C("Monkey D. Luffy", "L", "P", 0, 5000, 0, ["Supernovas","Straw Hat Crew"], "Life 5 · [Activate: Main] [Once Per Turn] DON!! −1: Set up to 1 of your Characters as active.", "OP05"),
  C("Roronoa Zoro", "L", "G", 0, 5000, 0, ["Straw Hat Crew"], "Life 5 · [When Attacking] [Once Per Turn] DON!! −1: This Leader gains +1000 power this turn.", "OP01"),
  C("Shanks", "L", "R", 0, 5000, 0, ["Four Emperors","Red-Haired Pirates"], "Life 5 · [Activate: Main] [Once Per Turn] You may rest 2 of your DON!!: Give 1 rested DON!! to a Character.", "OP01"),
  C("Charlotte Katakuri", "L", "Y", 0, 5000, 0, ["Big Mom Pirates"], "Life 4 · [DON!!×1] [Your Turn] When a Life card is added to your hand, draw 1.", "OP03"),
  // characters — purple
  C("Nico Robin", "C", "P", 4, 5000, 1000, ["Straw Hat Crew"], "[On Play] DON!! −1: Draw 1 card.", "OP05"),
  C("Trafalgar Law", "C", "P", 5, 6000, 0, ["Heart Pirates"], "[Activate: Main] You may return this Character to your hand: Set 1 DON!! as active.", "OP02"),
  C("Sabo", "C", "P", 3, 4000, 1000, ["Revolutionary Army"], "[On Play] Give up to 1 rested DON!! to this Character.", "OP05"),
  // green
  C("Roronoa Zoro", "C", "G", 3, 5000, 1000, ["Straw Hat Crew"], "[Rush] (This card can attack on the turn it is played.)", "OP01"),
  C("Yamato", "C", "G", 4, 5000, 1000, ["Land of Wano"], "[On Play] K.O. up to 1 of your opponent's rested Characters with a cost of 3 or less.", "OP04"),
  C("Carrot", "C", "G", 2, 3000, 1000, ["Minks"], "[On K.O.] You may rest 1 of your DON!!: Draw 1 card.", "OP04"),
  // red
  C("Portgas D. Ace", "C", "R", 4, 6000, 0, ["Whitebeard Pirates"], "[On Play] Deal 2 damage to up to 1 of your opponent's Characters (−2000 power this turn).", "OP02"),
  C("Otama", "C", "R", 1, 2000, 1000, ["Land of Wano"], "[On Play] Give up to 1 rested DON!! to a Character.", "OP04"),
  C("Uta", "C", "R", 5, 6000, 0, ["FILM"], "[On Play] K.O. up to 1 of your opponent's Characters with a cost of 4 or less.", "OP07"),
  // blue
  C("Sakazuki", "C", "B", 6, 7000, 0, ["Navy"], "[On Play] Return 1 of your opponent's Characters with a cost of 5 or less to its owner's hand.", "OP05"),
  C("Borsalino", "C", "B", 4, 5000, 1000, ["Navy"], "[On Play] Look at 5 cards from the top of your deck; reveal 1 Navy type and add it to hand.", "OP05"),
  C("Tashigi", "C", "B", 2, 3000, 1000, ["Navy"], "[On Play] Return up to 1 cost-2-or-less Character to the bottom of the deck.", "OP06"),
  // yellow
  C("Charlotte Linlin", "C", "Y", 7, 8000, 0, ["Big Mom Pirates"], "[On Play] Add 1 card from the top of your Life to your hand, then deal 1 Life damage.", "OP03"),
  C("Charlotte Perospero", "C", "Y", 3, 4000, 1000, ["Big Mom Pirates"], "[On Play] Trigger: Activate this card's effect from your Life.", "OP03"),
  // black
  C("Crocodile", "C", "K", 5, 6000, 0, ["Baroque Works"], "[On Play] If your opponent has 6+ Characters, K.O. up to 1 of them.", "OP02"),
  C("Smoker", "C", "K", 4, 5000, 1000, ["Navy"], "[On Play] Set up to 1 cost-3-or-less Character as rested. It can't attack next turn.", "OP06"),
  C("Mihawk", "C", "K", 5, 6000, 0, ["Seven Warlords"], "[DON!!×2] [When Attacking] Your opponent trashes 1 card from their hand.", "OP01"),
  // events
  C("Guard Point", "E", "R", 1, 0, 0, ["Straw Hat Crew"], "[Counter] Up to 1 of your Leader or Characters gains +3000 power this battle.", "OP01"),
  C("Jet Pistol", "E", "P", 2, 0, 0, ["Straw Hat Crew"], "[Main] K.O. up to 1 of your opponent's cost-4-or-less Characters.", "OP05"),
  C("Radical Beam!!", "E", "G", 1, 0, 0, ["Straw Hat Crew"], "[Counter] Up to 1 of your Characters gains +2000 power. Draw 1 if it's a Straw Hat.", "OP01"),
  C("Navy HQ", "E", "B", 3, 0, 0, ["Navy"], "[Main] Return up to 1 cost-6-or-less Character to its owner's hand.", "OP05"),
  // stages
  C("Thousand Sunny", "S", "R", 2, 0, 0, ["Straw Hat Crew"], "[Activate: Main] [Once Per Turn] DON!! −1: This turn, your Leader gains +1000 power.", "OP03"),
  C("Wano Country", "S", "G", 1, 0, 0, ["Land of Wano"], "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power until end of turn.", "OP04"),
  C("Totto Land", "S", "Y", 2, 0, 0, ["Big Mom Pirates"], "[Activate: Main] [Once Per Turn] DON!! −1: Add the top card of your Life to your hand.", "OP03"),
];

const TYPE_LABEL = { L:"Leader", C:"Character", E:"Event", S:"Stage" };

/* ---------- keyword detection (from effect text) ---------- */
const KEYWORDS = ["On Play", "When Attacking", "Activate: Main", "On K.O.", "Rush", "Blocker", "Double Attack", "Banish", "Trigger", "Counter"];
function cardKeywords(card) {
  const fx = card.fx || "";
  return KEYWORDS.filter((k) => fx.includes(k));
}
/* counter bucket: 0 = none, 1000/2000 = value, "event" = [Counter] event */
function counterKind(card) {
  if ((card.fx || "").includes("[Counter]")) return "event";
  if (card.cnt >= 2000) return "2000";
  if (card.cnt >= 1000) return "1000";
  return "none";
}

/* ---------- the card tile (placeholder art) ---------- */
function CardTile({ card, count, onClick, onHover, faded, mini, dim, locked }) {
  const c = hueColor(card.col);
  return (
    <button className={"db-card t-" + card.t + (faded ? " faded" : "") + (mini ? " mini" : "") + (dim ? " dim" : "") + (locked ? " locked" : "")}
      style={{ "--cc": c }} onClick={onClick} onMouseEnter={onHover} onFocus={onHover} title={card.name}>
      <span className="db-card-art">
        <span className="db-card-glow" style={{ background:`radial-gradient(120% 80% at 50% 12%, ${c}dd, ${c}55 46%, #0a0f17 88%)` }}></span>
        {card.t === "L"
          ? <span className="db-card-badge"><I n="leader" size={mini?12:15} /></span>
          : <span className="db-card-cost">{card.cost}</span>}
        <span className="db-card-emblem">{card.name[0]}</span>
        {(card.t === "C" || card.t === "L") && <span className="db-card-pow">{card.pow}</span>}
        {locked && <span className="db-card-lock"><I n="lock" size={mini?12:15} /></span>}
        <span className="db-card-foot"><span className="db-card-name">{card.name}</span></span>
      </span>
      {count != null && count > 0 && <span className="db-card-count">{count}</span>}
    </button>);
}

/* ---------- left: card detail panel ---------- */
function Detail({ card, inDeck, add, remove, canAdd, isCurrentLeader, offColor, allowedNames }) {
  if (!card) {
    return <aside className="db-detail empty"><div className="db-detail-empty"><I n="cards" size={34} /><p>Select a card to inspect it</p></div></aside>;
  }
  const c = hueColor(card.col);
  return (
    <aside className="db-detail">
      <div className="db-detail-top">
        <div className="db-detail-name">{card.name}</div>
        <span className="db-color-chip" style={{ "--cc": c }}>{HUE_NAME[card.col]}</span>
      </div>
      <div className="db-detail-art" style={{ "--cc": c }}>
        <span className="db-card-glow" style={{ background:`radial-gradient(120% 80% at 50% 10%, ${c}ee, ${c}66 48%, #0a0f17 90%)` }}></span>
        {card.t === "L" ? <span className="db-detail-badge"><I n="leader" size={26} /></span> : <span className="db-detail-cost">{card.cost}</span>}
        <span className="db-detail-emblem">{card.name[0]}</span>
        {(card.t === "C" || card.t === "L") && <span className="db-detail-pow">{card.pow}<small>power</small></span>}
        <image-slot id={"db-art-" + card.id} class="db-detail-slot" shape="rect" placeholder="Drop card art"></image-slot>
      </div>
      <div className="db-detail-stats">
        {card.t !== "L" && <div className="db-stat"><span>Cost</span><b>{card.cost}</b></div>}
        {(card.t === "C") && <div className="db-stat"><span>Power</span><b>{card.pow}</b></div>}
        {(card.t === "C") && <div className="db-stat"><span>Counter</span><b>{card.cnt ? "+" + card.cnt : "—"}</b></div>}
        <div className="db-stat"><span>Set</span><b>{card.set}</b></div>
      </div>
      <div className="db-detail-type">[{TYPE_LABEL[card.t]}{card.tags.length ? " · " + card.tags.join(" / ") : ""}]</div>
      <p className="db-detail-fx">{card.fx}</p>
      <div className="db-detail-actions">
        {card.t === "L"
          ? (isCurrentLeader
              ? <div className="db-leader-state"><I n="check" size={16} /> Your deck’s Leader</div>
              : <button className="db-setleader" onClick={() => add(card)}><I n="leader" size={16} /> Use as Leader</button>)
          : offColor
            ? <div className="db-offcolor"><I n="lock" size={15} /> Off-color — needs a {allowedNames} Leader</div>
            : <div className="db-counter">
              <button className="db-cbtn minus" onClick={() => remove(card)} disabled={!inDeck}><I n="minus" size={16} /></button>
              <span className="db-counter-val"><b>{inDeck}</b> <small>/ {card.max} in deck</small></span>
              <button className="db-cbtn plus" onClick={() => add(card)} disabled={!canAdd}><I n="plus" size={16} /></button>
            </div>}
      </div>
    </aside>);
}

/* =================================================================
   MAIN
   ================================================================= */
const MAIN_MAX = 50;
function DeckBuilder() {
  const leadersPool = POOL.filter((c) => c.t === "L");
  const [leader, setLeader] = useState(leadersPool[0]);
  const [deck, setDeck] = useState({});           // id -> count (non-leader)
  const [sel, setSel] = useState(leadersPool[0]);
  const [deckName, setDeckName] = useState("New Deck");
  const [editName, setEditName] = useState(false);

  // right-pane filters
  const [q, setQ] = useState("");
  const [colFilter, setColFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sort, setSort] = useState("Cost ↑");

  // advanced filters (modal)
  const [advOpen, setAdvOpen] = useState(false);
  const [counterF, setCounterF] = useState("Any");      // Any | has | 1000 | 2000 | none | event
  const [kwF, setKwF] = useState([]);                   // active keywords (AND)
  const toggleKw = (k) => setKwF((s) => s.includes(k) ? s.filter((x) => x !== k) : [...s, k]);
  const resetAdv = () => { setCounterF("Any"); setKwF([]); };
  const advCount = (counterF !== "Any" ? 1 : 0) + kwF.length;

  const mainCount = useMemo(() => Object.values(deck).reduce((a, b) => a + b, 0), [deck]);
  const cardById = useMemo(() => Object.fromEntries(POOL.map((c) => [c.id, c])), []);

  // colors allowed by the current leader — only these may be added to the Main Deck
  const allowed = useMemo(() => leader ? [leader.col] : Object.keys(HUE), [leader]);
  const allowedNames = allowed.map((c) => HUE_NAME[c]).join(" / ");
  const colorOK = (card) => allowed.includes(card.col);

  // tiny toast
  const [toast, setToast] = useState(null);
  const flash = (msg) => { setToast(msg); clearTimeout(window.__dbT); window.__dbT = setTimeout(() => setToast(null), 2200); };

  const add = (card) => {
    if (card.t === "L") {
      setLeader(card); setSel(card);
      // prune off-color cards that no longer match the new leader
      setDeck((d) => {
        const n = {}; let dropped = 0;
        for (const [id, cnt] of Object.entries(d)) {
          if (cardById[id].col === card.col) n[id] = cnt; else dropped += cnt;
        }
        if (dropped) flash(dropped + " off-color card" + (dropped > 1 ? "s" : "") + " removed — deck now matches " + HUE_NAME[card.col]);
        return n;
      });
      return;
    }
    if (!colorOK(card)) { flash("Only " + allowedNames + " cards can go in this deck (your Leader’s color)"); setSel(card); return; }
    setDeck((d) => {
      const cur = d[card.id] || 0;
      if (cur >= card.max || mainCount >= MAIN_MAX) return d;
      return { ...d, [card.id]: cur + 1 };
    });
    setSel(card);
  };
  const remove = (card) => {
    setDeck((d) => {
      const cur = d[card.id] || 0;
      if (cur <= 0) return d;
      const n = { ...d }; if (cur === 1) delete n[card.id]; else n[card.id] = cur - 1;
      return n;
    });
    setSel(card);
  };
  const clearDeck = () => { setDeck({}); };

  // deck cards sorted for display (cost then color then name)
  const deckCards = useMemo(() => {
    const arr = [];
    for (const [id, n] of Object.entries(deck)) arr.push({ card: cardById[id], n });
    arr.sort((a, b) => a.card.cost - b.card.cost || a.card.col.localeCompare(b.card.col) || a.card.name.localeCompare(b.card.name));
    return arr;
  }, [deck, cardById]);

  // curve (cost 0..7+)
  const curve = useMemo(() => {
    const buckets = [0,0,0,0,0,0,0,0]; // 0..7+
    for (const { card, n } of deckCards) { const k = Math.min(7, card.cost); buckets[k] += n; }
    return buckets;
  }, [deckCards]);
  const curveMax = Math.max(1, ...curve);

  // color breakdown
  const colorMix = useMemo(() => {
    const m = {};
    for (const { card, n } of deckCards) m[card.col] = (m[card.col] || 0) + n;
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  }, [deckCards]);

  // right pane list
  const list = useMemo(() => {
    let l = POOL.filter((c) => c.t !== "L" || colFilter !== "All" ? true : true); // keep all; leaders shown in own group
    l = POOL.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (colFilter !== "All" && c.col !== colFilter) return false;
      if (typeFilter !== "All" && TYPE_LABEL[c.t] !== typeFilter) return false;
      if (counterF !== "Any") {
        const ck = counterKind(c);
        if (counterF === "has" && (ck === "none")) return false;
        if (counterF === "1000" && ck !== "1000") return false;
        if (counterF === "2000" && ck !== "2000") return false;
        if (counterF === "none" && ck !== "none") return false;
        if (counterF === "event" && ck !== "event") return false;
      }
      if (kwF.length) { const ck = cardKeywords(c); if (!kwF.every((k) => ck.includes(k))) return false; }
      return true;
    });
    const dir = sort.includes("↓") ? -1 : 1;
    if (sort.startsWith("Cost")) l = [...l].sort((a,b)=>(a.cost-b.cost)*dir || a.name.localeCompare(b.name));
    else if (sort.startsWith("Power")) l = [...l].sort((a,b)=>((a.pow||0)-(b.pow||0))*dir || a.name.localeCompare(b.name));
    else if (sort.startsWith("Color")) l = [...l].sort((a,b)=>a.col.localeCompare(b.col)*dir || a.cost-b.cost);
    else l = [...l].sort((a,b)=>a.name.localeCompare(b.name)*dir);
    return l;
  }, [q, colFilter, typeFilter, sort, counterF, kwF]);

  const deckValid = leader && mainCount === MAIN_MAX;

  return (
    <div className="snp db">
      {/* header */}
      <header className="snp-head db-head">
        <a className="snp-back" href="Home.html" title="Back to Main Menu"><I n="back" /></a>
        <div className="snp-head-title">
          <h1>Deck Constructor</h1>
          <span className="sn-kicker">Build your crew</span>
        </div>
        <div className="snp-head-r db-head-r">
          <span className={"db-deckstate" + (deckValid ? " ok" : "")}>{deckValid ? "Deck legal" : (leader ? mainCount + " / 50 cards" : "Pick a leader")}</span>
          <button className="db-save" disabled={!deckValid}><I n="save" size={16} /> Save Deck</button>
        </div>
      </header>

      <div className="db-body">
        {/* LEFT — detail */}
        <Detail card={sel}
          inDeck={sel ? (deck[sel.id] || 0) : 0}
          add={add} remove={remove}
          isCurrentLeader={sel && sel.t === "L" && leader && leader.id === sel.id}
          offColor={sel && sel.t !== "L" && !colorOK(sel)}
          allowedNames={allowedNames}
          canAdd={sel && sel.t !== "L" && colorOK(sel) && (deck[sel.id] || 0) < sel.max && mainCount < MAIN_MAX} />

        {/* CENTER — current deck */}
        <section className="db-deck">
          <div className="db-deck-head">
            {editName
              ? <input className="db-deckname-input" autoFocus value={deckName}
                  onChange={(e) => setDeckName(e.target.value)} onBlur={() => setEditName(false)}
                  onKeyDown={(e) => e.key === "Enter" && setEditName(false)} />
              : <button className="db-deckname" onClick={() => setEditName(true)}>{deckName} <I n="edit" size={14} /></button>}
            <div className="db-deck-tools">
              <button className="db-tool" title="Auto-sort (visual)"><I n="sort" size={16} /></button>
              <button className="db-tool" title="Clear deck" onClick={clearDeck}><I n="trash" size={16} /></button>
            </div>
          </div>

          <div className="db-deck-scroll">
            {/* leader row */}
            <div className="db-section-h"><span>Leader</span><span className="db-sec-count">{leader ? 1 : 0} / 1</span></div>
            <div className="db-leader-row">
              {leader
                ? <div className="db-leader-card"><CardTile card={leader} onClick={() => setSel(leader)} onHover={() => setSel(leader)} /></div>
                : <div className="db-leader-empty">Select a leader from the list →</div>}
              {leader &&
                <div className="db-leader-info">
                  <div className="db-leader-name">{leader.name}</div>
                  <div className="db-leader-tags">{HUE_NAME[leader.col]} · {leader.tags.join(" / ")}</div>
                  <div className="db-don">DON!! Deck <b>10</b> <small>(fixed)</small></div>
                </div>}
            </div>

            {/* main deck */}
            <div className="db-section-h">
              <span>Main Deck</span>
              <span className={"db-sec-count" + (mainCount === MAIN_MAX ? " full" : "")}>{mainCount} / {MAIN_MAX}</span>
            </div>
            {deckCards.length === 0
              ? <div className="db-deck-empty"><I n="cards" size={30} /><p>Add cards from the list on the right.<br/>A legal deck has exactly 50 cards.</p></div>
              : <div className="db-deck-grid">
                  {deckCards.map(({ card, n }) => (
                    <CardTile key={card.id} card={card} count={n} mini onClick={() => { setSel(card); remove(card); }} onHover={() => setSel(card)} />
                  ))}
                </div>}
          </div>

          {/* footer: curve + colors */}
          <div className="db-deck-foot">
            <div className="db-curve">
              <span className="db-foot-label">Cost curve</span>
              <div className="db-curve-bars">
                {curve.map((v, k) => (
                  <div className="db-curve-col" key={k}>
                    <div className="db-curve-bar" style={{ height: (8 + (v / curveMax) * 46) + "px", opacity: v ? 1 : .3 }}>
                      {v > 0 && <span>{v}</span>}
                    </div>
                    <span className="db-curve-k">{k === 7 ? "7+" : k}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="db-colors">
              <span className="db-foot-label">Colors</span>
              <div className="db-color-bars">
                {colorMix.length === 0 ? <span className="db-color-none">—</span> :
                  colorMix.map(([col, n]) => (
                    <span className="db-color-seg" key={col} style={{ background: hueColor(col) }} title={HUE_NAME[col] + ": " + n}>
                      {n}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT — card list */}
        <section className="db-list">
          <div className="db-list-tabs">
            <button className="db-tab active"><I n="cards" size={15} /> Card List</button>
            <button className="db-tab"><I n="star" size={15} /> Favorites</button>
            <a className="db-tab" href="My Decks.html"><I n="save" size={15} /> My Decks</a>
          </div>
          <div className="db-search">
            <I n="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by card name…" />
          </div>
          <div className="db-filters">
            <div className="db-colfilter">
              <button className={"db-colpill all" + (colFilter === "All" ? " on" : "")} onClick={() => setColFilter("All")}>All</button>
              {Object.keys(HUE).map((h) => (
                <button key={h} className={"db-colpill" + (colFilter === h ? " on" : "")} style={{ "--cc": hueColor(h) }}
                  onClick={() => setColFilter(colFilter === h ? "All" : h)} title={HUE_NAME[h]}></button>
              ))}
            </div>
            <Select value={typeFilter} onChange={setTypeFilter} options={["All", "Leader", "Character", "Event", "Stage"]} />
            <Select value={sort} onChange={setSort} options={["Cost ↑", "Cost ↓", "Power ↑", "Power ↓", "Color", "Name"]} />
          </div>
          <div className="db-list-subbar">
            <button className={"db-advbtn" + (advCount ? " on" : "")} onClick={() => setAdvOpen(true)}>
              <I n="sliders" size={15} /> Advanced filters{advCount ? <span className="db-adv-badge">{advCount}</span> : null}
            </button>
            <span className="db-list-count">{list.length} cards</span>
          </div>
          <div className="db-list-grid">
            {list.map((card) => (
              <CardTile key={card.id} card={card}
                count={card.t === "L" ? (leader && leader.id === card.id ? 1 : 0) : (deck[card.id] || 0)}
                dim={card.t !== "L" && (deck[card.id] || 0) >= card.max}
                locked={card.t !== "L" && !colorOK(card)}
                onClick={() => add(card)}
                onHover={() => setSel(card)} />
            ))}
          </div>
        </section>
      </div>

      {/* dock */}
      <div className="snp-dock">
        <a className="snp-iconbtn" href="#" title="Messages"><I n="chat" /><span className="snp-dock-badge">3</span></a>
        <a className="snp-iconbtn" href="#" title="Friends online"><I n="friends" /></a>
      </div>

      {/* toast */}
      {toast && <div className="db-toast">{toast}</div>}

      {/* advanced filters modal */}
      {advOpen &&
        <div className="db-modal-overlay" onClick={() => setAdvOpen(false)}>
          <div className="db-modal" onClick={(e) => e.stopPropagation()}>
            <div className="db-modal-head">
              <div className="db-modal-title"><I n="sliders" size={18} /> Advanced Filters</div>
              <button className="db-modal-x" onClick={() => setAdvOpen(false)} title="Close">×</button>
            </div>
            <div className="db-modal-body">
              <div className="db-mod-section">
                <div className="db-mod-label">Counter</div>
                <div className="db-mod-chips">
                  {[["Any","Any"],["has","Has counter"],["1000","+1000"],["2000","+2000"],["event","[Counter] event"],["none","No counter"]].map(([v,label]) => (
                    <button key={v} className={"db-chip" + (counterF === v ? " on" : "")} onClick={() => setCounterF(v)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="db-mod-section">
                <div className="db-mod-label">Keywords <small>(matches all selected)</small></div>
                <div className="db-mod-chips">
                  {KEYWORDS.map((k) => (
                    <button key={k} className={"db-chip" + (kwF.includes(k) ? " on" : "")} onClick={() => toggleKw(k)}>{k}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="db-modal-foot">
              <button className="db-mod-reset" onClick={resetAdv} disabled={!advCount}>Reset</button>
              <span className="db-mod-result">{list.length} cards match</span>
              <button className="db-mod-apply" onClick={() => setAdvOpen(false)}>Done</button>
            </div>
          </div>
        </div>}
    </div>);
}

window.DeckBuilder = DeckBuilder;
