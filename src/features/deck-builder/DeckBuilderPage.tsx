// @ts-nocheck — ported Claude-design prototype; keep logic verbatim, skip strict typing
/* ===========================================================
   Sailing Network — Deck Constructor
   Adapted from a Master-Duel-style 3-pane builder, One Piece TCG rules:
   1 Leader + 50-card Main Deck (max 4 copies) + fixed 10 DON!! deck.
   No crafting / dismantle / obtain / ownership — free simulator.
   Exports window.DeckBuilder
   =========================================================== */
import { PixelIcon } from "../pixel/PixelIcon";
import * as React from "react";
import { useUiStore } from "../../app/uiStore";
import { loadCards } from "../cards/cardsDb";
import { api } from "../../lib/api";
import { Dock } from "../profiles/ProfilePages";
import { parseDeckText } from "./deckText";
import { searchRank } from "./cardSearch";
import { rememberDuelDeck } from "../duel-room/duelDeck";
import "../home/home.css";
import "../profiles/profiles.css";
import "./deckbuilder.css";
import { PixelScene } from "../pixel/PixelScene";
const { useState, useMemo, useRef, useEffect } = React;

/* ---------- icons: the site's pixel set (features/pixel/icons.ts) ---------- */
const ICON_ALIAS = { leader: "crown" };
function I({ n, size=20 }) {
  return <PixelIcon name={ICON_ALIAS[n] ?? n} size={size} />;
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

/* ---------- map the real card database (cardsDb) to the builder's shape ----------
   The builder was written around a compact card shape; rather than rewrite all of
   its logic we adapt each real Card into it. Colors become single letters; `cols`
   keeps the full set so dual-color legality works. For Leaders the dataset stores
   Life in `cost` (not displayed as a cost). */
const COLOR_LETTER = { Red:"R", Green:"G", Blue:"B", Purple:"P", Black:"K", Yellow:"Y" };
const CAT_T = { Leader:"L", Character:"C", Event:"E", Stage:"S" };
const TYPE_LABEL = { L:"Leader", C:"Character", E:"Event", S:"Stage" };

function mapCard(c) {
  const cols = (c.colors || []).map((x) => COLOR_LETTER[x]).filter(Boolean);
  const t = CAT_T[c.category] || "C";
  return {
    id: c.id,                          // official code, e.g. "OP01-001"
    name: c.name,
    t,
    col: cols[0] || "R",               // primary color (display/glow)
    cols: cols.length ? cols : ["R"],  // all colors (legality)
    cost: c.cost ?? 0,                 // Life for leaders
    pow: c.power ?? 0,
    cnt: c.counter ?? 0,
    tags: Array.isArray(c.types) ? c.types : [],
    fx: c.effect || "",
    trigger: c.trigger || null,
    set: c.set,
    attrs: Array.isArray(c.attributes) ? c.attributes : [],
    rarity: c.rarity || "",
    image: c.image || "",
    max: t === "L" ? 1 : 4,
  };
}

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
/* left click = add one copy, right click = take one out (list AND deck panel) */
function CardTile({ card, count, onClick, onRemove, onHover, faded, mini, dim, locked }) {
  const c = hueColor(card.col);
  const [noArt, setNoArt] = React.useState(!card.image); // no file for it yet (revealed cards)
  return (
    <button className={"db-card t-" + card.t + (faded ? " faded" : "") + (mini ? " mini" : "") + (dim ? " dim" : "") + (locked ? " locked" : "")}
      style={{ "--cc": c }} onClick={onClick} onMouseEnter={onHover} onFocus={onHover}
      onContextMenu={onRemove ? (e) => { e.preventDefault(); onRemove(); } : undefined}
      title={card.name + (onRemove ? " — left click: add · shift + click: all copies · right click: remove" : "")}>
      <span className="db-card-art">
        <span className="db-card-glow" style={{ background:`radial-gradient(120% 80% at 50% 12%, ${c}dd, ${c}55 46%, #0a0f17 88%)` }}></span>
        {!noArt && <img className="db-card-img" src={card.image} loading="lazy" alt="" draggable={false}
          onError={() => setNoArt(true)} />}
        {/* the cost is printed on the card; write it only when there is no image */}
        {card.t === "L"
          ? <span className="db-card-badge"><I n="leader" size={mini?12:15} /></span>
          : noArt && <span className="db-card-cost">{card.cost}</span>}
        {locked && <span className="db-card-lock"><I n="lock" size={mini?12:15} /></span>}
        <span className="db-card-foot"><span className="db-card-name">{card.name}</span></span>
      </span>
      {count != null && count > 0 && <span className="db-card-count">{count}</span>}
    </button>);
}

/* ---------- left: card detail panel ---------- */
function Detail({ card, inDeck, add, remove, canAdd, isCurrentLeader, offColor, allowedNames, isFav, toggleFav, zoom }) {
  // the picture of this card failed to load: write the card instead (revealed cards have none yet)
  const [brokenId, setBrokenId] = React.useState(null);
  if (!card) {
    return <aside className="db-detail empty"><div className="db-detail-empty"><I n="cards" size={34} /><p>Select a card to inspect it</p></div></aside>;
  }
  const c = hueColor(card.col);
  return (
    <aside className="db-detail">
      {/* the card image already shows cost, power, counter and text: show it alone */}
      <div className="db-detail-art" style={{ "--cc": c }}>
        {card.image && brokenId !== card.id
          ? <img className="db-detail-img zoomable" src={card.image} loading="lazy" alt={card.name} draggable={false} title="Click to enlarge"
              onClick={() => zoom(card)} onError={() => setBrokenId(card.id)} />
          : <div className="db-detail-textcard" data-card-text>
              <b>{card.name}</b> <small>{card.id}</small>
              <div>{card.t === "L" ? `Life ${card.cost}` : `Cost ${card.cost}`}
                {card.pow ? ` · ${card.pow} power` : ""}{card.cnt ? ` · +${card.cnt} counter` : ""}</div>
              {card.tags.length > 0 && <div className="db-textcard-types">{card.tags.join(" / ")}</div>}
              {card.fx && card.fx !== "-" && <p>{card.fx}</p>}
              {card.trigger && <p>[Trigger] {card.trigger}</p>}
              <small>No picture yet</small>
            </div>}
      </div>
      <div className="db-detail-actions">
        <button className={"db-star" + (isFav ? " on" : "")} data-act="card-star" onClick={() => toggleFav(card.id)}>
          <I n="star" size={14} /> {isFav ? "In favorites" : "Add to favorites"}
        </button>
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
/** The deck as text, to tell whether anything changed since it was saved. */
function deckSnapshot(name, leaderId, deck) {
  return JSON.stringify([name, leaderId, Object.entries(deck).sort(([a], [b]) => a.localeCompare(b))]);
}
const RENDER_LIMIT = 240; // cap rendered tiles (catalog is ~2.6k cards)
function DeckBuilder() {
  const setView = useUiStore((s) => s.setView);
  const editingDeckId = useUiStore((s) => s.editingDeckId);
  const [pool, setPool] = useState([]);            // mapped real cards
  const [loading, setLoading] = useState(true);
  const [leader, setLeader] = useState(null);
  const [deck, setDeck] = useState({});           // id -> count (non-leader)
  const [sel, setSel] = useState(null);
  const [deckName, setDeckName] = useState("New Deck");
  const [editName, setEditName] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentDeckId, setCurrentDeckId] = useState(null); // null = unsaved/new
  const [saving, setSaving] = useState(false);
  const [zoomed, setZoomed] = useState(null);      // the card shown full size
  // what the deck looked like when last loaded or saved (see `dirty`)
  const [savedSnap, setSavedSnap] = useState(() => deckSnapshot("New Deck", null, {}));
  const [leaveAsk, setLeaveAsk] = useState(null);  // the page "Back" wants, while asking about unsaved changes

  // load the card database, then (if opened from My Decks) the chosen deck
  useEffect(() => {
    let alive = true;
    (async () => {
      const cards = await loadCards();
      if (!alive) return;
      const mapped = cards.map(mapCard);
      const byId = Object.fromEntries(mapped.map((c) => [c.id, c]));
      setPool(mapped);
      const firstLeader = mapped.find((c) => c.t === "L") || null;

      if (editingDeckId) {
        try {
          const { deck: d } = await api.deck(editingDeckId);
          if (!alive) return;
          const ldr = byId[d.leaderId] || firstLeader;
          setLeader(ldr);
          setSel(ldr);
          const dm = {};
          for (const c of d.cards) if (byId[c.id] && byId[c.id].t !== "L") dm[c.id] = c.count;
          setDeck(dm);
          setDeckName(d.name);
          setCurrentDeckId(d.id);
          setSavedSnap(deckSnapshot(d.name, ldr ? ldr.id : null, dm));
        } catch {
          if (!alive) return;
          setLeader(null);
          setSel(firstLeader);
        }
      } else {
        // no Leader until the player picks one; the panel shows the first as an example
        setLeader(null);
        setSel(firstLeader);
        setCurrentDeckId(null);
        setDeck({});
        setDeckName("New Deck");
        setSavedSnap(deckSnapshot("New Deck", null, {}));
      }
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [editingDeckId]);

  // right-pane tab + favorites (persisted in localStorage)
  const [activeTab, setActiveTab] = useState("list"); // "list" | "favs"
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sn_fav_cards") || "[]")); }
    catch { return new Set(); }
  });
  const toggleFav = (id) => {
    setFavorites((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem("sn_fav_cards", JSON.stringify([...n]));
      return n;
    });
  };

  // right-pane filters
  const [q, setQ] = useState("");
  const [colFilter, setColFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [archetype, setArchetype] = useState("");       // card type text, e.g. "rocks pirates"
  const [sort, setSort] = useState("Cost ↑");

  // import a decklist (modal)
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState([]);
  const [importPartial, setImportPartial] = useState(false); // the only errors are lines that can be skipped

  // advanced filters (modal)
  const [advOpen, setAdvOpen] = useState(false);
  const [counterF, setCounterF] = useState("Any");      // Any | has | 1000 | 2000 | none | event
  const [kwF, setKwF] = useState([]);                   // active keywords (AND)
  const toggleKw = (k) => setKwF((s) => s.includes(k) ? s.filter((x) => x !== k) : [...s, k]);
  const [costF, setCostF] = useState([]);               // costs (10 = 10 or more); Leaders have none
  const toggleCost = (n) => setCostF((s) => s.includes(n) ? s.filter((x) => x !== n) : [...s, n]);
  const [setF, setSetF] = useState("Any");
  const [powerF, setPowerF] = useState("Any");
  const [rarityF, setRarityF] = useState("Any");
  const [attrF, setAttrF] = useState("Any");
  const resetAdv = () => { setCounterF("Any"); setKwF([]); setCostF([]); setSetF("Any"); setPowerF("Any"); setRarityF("Any"); setAttrF("Any"); };
  const advCount = (counterF !== "Any" ? 1 : 0) + kwF.length + costF.length + [setF, powerF, rarityF, attrF].filter((v) => v !== "Any").length;
  const filtersOn = !!q || colFilter !== "All" || typeFilter !== "All" || !!archetype || advCount > 0;
  const clearFilters = () => { setQ(""); setColFilter("All"); setTypeFilter("All"); setArchetype(""); resetAdv(); };

  const mainCount = useMemo(() => Object.values(deck).reduce((a, b) => a + b, 0), [deck]);
  const cardById = useMemo(() => Object.fromEntries(pool.map((c) => [c.id, c])), [pool]);

  // colors allowed by the current leader — a card may go in only if ALL of its
  // colors are among the leader's colors (so a Red/Green leader allows Red, Green,
  // and Red/Green cards; a mono-Red leader allows only mono-Red).
  const allowed = useMemo(() => leader ? leader.cols : Object.keys(HUE), [leader]);
  const allowedNames = allowed.map((c) => HUE_NAME[c]).join(" / ");
  const colorOK = (card) => card.cols.every((c) => allowed.includes(c));

  // tiny toast
  const [toast, setToast] = useState(null);
  const flash = (msg) => { setToast(msg); clearTimeout(window.__dbT); window.__dbT = setTimeout(() => setToast(null), 2200); };

  /** `copies`: shift + click takes as many as the card allows. */
  const add = (card, copies = 1) => {
    if (card.t === "L") {
      setLeader(card); setSel(card);
      // prune off-color cards that no longer match the new leader
      setDeck((d) => {
        const n = {}; let dropped = 0;
        for (const [id, cnt] of Object.entries(d)) {
          const cc = cardById[id];
          if (cc && cc.cols.every((x) => card.cols.includes(x))) n[id] = cnt; else dropped += cnt;
        }
        if (dropped) flash(dropped + " off-color card" + (dropped > 1 ? "s" : "") + " removed — deck now matches " + card.cols.map((x) => HUE_NAME[x]).join("/"));
        return n;
      });
      return;
    }
    if (!colorOK(card)) { flash("Only " + allowedNames + " cards can go in this deck (your Leader’s color)"); setSel(card); return; }
    const cur = deck[card.id] || 0;
    if (cur >= card.max) { flash("Already " + card.max + " copies of " + card.name + ": the maximum"); setSel(card); return; }
    if (mainCount >= MAIN_MAX) { flash("The deck is full: " + MAIN_MAX + " cards"); setSel(card); return; }
    const n = Math.min(copies, card.max - cur, MAIN_MAX - mainCount);
    setDeck((d) => ({ ...d, [card.id]: (d[card.id] || 0) + n }));
    setSel(card);
  };
  const remove = (card) => {
    if (card.t === "L") { if (leader && leader.id === card.id) setLeader(null); setSel(card); return; }
    setDeck((d) => {
      const cur = d[card.id] || 0;
      if (cur <= 0) return d;
      const n = { ...d }; if (cur === 1) delete n[card.id]; else n[card.id] = cur - 1;
      return n;
    });
    setSel(card);
  };
  const clearDeck = () => { setDeck({}); };

  // Replace the deck on screen with a pasted list; nothing is saved until Save.
  const importDeck = (skipBadLines = false) => {
    const { leaderId, cards, errors, lineErrors } = parseDeckText(importText, (id) => cardById[id]);
    setImportErrors(errors);
    setImportPartial(errors.length > 0 && errors.length === lineErrors.length);
    if (errors.length && !(skipBadLines && errors.length === lineErrors.length)) return;
    setImportErrors([]);
    setImportPartial(false);
    const newLeader = cardById[leaderId];
    setLeader(newLeader);
    setSel(newLeader);
    setDeck(cards);
    setImportOpen(false);
    setImportText("");
    flash("Imported " + Object.values(cards).reduce((a, b) => a + b, 0) + " / " + MAIN_MAX + " cards" + (lineErrors.length ? " (" + lineErrors.length + " lines skipped)" : "") + " — press Save to keep them");
  };

  // Persist to the backend: PATCH if this deck already exists, else POST a new one.
  const saveDeck = async () => {
    if (!leader || saving) return false;
    setSaving(true);
    try {
      const cards = Object.entries(deck).map(([id, count]) => ({ id, count }));
      const payload = { name: deckName, leaderId: leader.id, leaderName: leader.name, cards };
      if (currentDeckId) {
        await api.updateDeck(currentDeckId, payload);
      } else {
        const { deck: created } = await api.createDeck(payload);
        setCurrentDeckId(created.id);
      }
      setSavedSnap(deckSnapshot(deckName, leader.id, deck));
      flash("Deck saved");
      return true;
    } catch (e) {
      flash((e && e.message) || "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const dirty = deckSnapshot(deckName, leader ? leader.id : null, deck) !== savedSnap;
  /** Leave the editor, asking first if there is something not saved. */
  const leaveTo = (next) => { if (dirty) setLeaveAsk(next); else setView(next); };
  /** To the Duel Room with this deck already chosen there. */
  const playWithDeck = () => { rememberDuelDeck(currentDeckId); setView("duel-room"); };

  // Copy the decklist as plain text: "{count}x{CODE}", leader first, one per line.
  const copyDeck = () => {
    const lines = [];
    if (leader) lines.push(`1x${leader.id}`);
    Object.entries(deck)
      .map(([id, n]) => [cardById[id], n])
      .filter(([c, n]) => c && n > 0)
      .sort((a, b) => a[0].id.localeCompare(b[0].id))
      .forEach(([c, n]) => lines.push(`${n}x${c.id}`));
    const text = lines.join("\n");
    const done = () => {
      setCopied(true);
      clearTimeout(window.__dbCopyT);
      window.__dbCopyT = setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      // fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  };

  // deck cards sorted for display (cost then color then name)
  const deckCards = useMemo(() => {
    const arr = [];
    for (const [id, n] of Object.entries(deck)) arr.push({ card: cardById[id], n });
    arr.sort((a, b) => a.card.cost - b.card.cost || a.card.col.localeCompare(b.card.col) || a.card.name.localeCompare(b.card.name));
    return arr;
  }, [deck, cardById]);

  // color breakdown
  const colorMix = useMemo(() => {
    const m = {};
    for (const { card, n } of deckCards) m[card.col] = (m[card.col] || 0) + n;
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  }, [deckCards]);

  // right pane list
  const archetypes = useMemo(() => [...new Set(pool.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)), [pool]);
  const { list, nameHits } = useMemo(() => {
    const arch = archetype.trim().toLowerCase();
    const rank = new Map();                              // card id → 0 found by name/code/type, 1 only in text
    let l = pool.filter((c) => {
      const r = searchRank(c, q);
      if (r === null) return false;
      rank.set(c.id, r);
      if (costF.length && (c.t === "L" || !costF.includes(Math.min(c.cost, 10)))) return false;
      if (setF !== "Any" && c.set !== setF) return false;
      if (powerF !== "Any" && String(c.pow) !== powerF) return false;
      if (rarityF !== "Any" && c.rarity !== rarityF) return false;
      if (attrF !== "Any" && !c.attrs.includes(attrF)) return false;
      if (colFilter !== "All" && !c.cols.includes(colFilter)) return false;
      if (typeFilter !== "All" && TYPE_LABEL[c.t] !== typeFilter) return false;
      if (arch && !c.tags.some((t) => t.toLowerCase().includes(arch))) return false;
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
    // the cards found by name, code or type first, then the ones found only in their text
    const byName = l.filter((c) => rank.get(c.id) === 0);
    return { list: [...byName, ...l.filter((c) => rank.get(c.id) === 1)], nameHits: byName.length };
  }, [pool, q, colFilter, typeFilter, archetype, sort, counterF, kwF, costF, setF, powerF, rarityF, attrF]);

  // the choices of the Advanced filters, from what the catalog really holds
  const options = useMemo(() => ({
    sets: [...new Set(pool.map((c) => c.set))].sort(),
    powers: [...new Set(pool.filter((c) => c.t !== "E" && c.t !== "S").map((c) => c.pow))].sort((a, b) => a - b).map(String),
    rarities: [...new Set(pool.map((c) => c.rarity).filter(Boolean))].sort(),
    attrs: [...new Set(pool.flatMap((c) => c.attrs))].filter((a) => a !== "Unknown").sort(),
  }), [pool]);

  // the numbers of the deck: cost curve (10 = 10 or more), kinds of card, counters
  const deckStats = useMemo(() => {
    const curve = Array(11).fill(0);
    const s = { curve, C: 0, E: 0, S: 0, c1000: 0, c2000: 0, counterEvents: 0, triggers: 0 };
    for (const { card, n } of deckCards) {
      curve[Math.min(card.cost, 10)] += n;
      s[card.t] += n;
      const ck = counterKind(card);
      if (ck === "1000") s.c1000 += n;
      if (ck === "2000") s.c2000 += n;
      if (ck === "event") s.counterEvents += n;
      if (card.trigger) s.triggers += n;
    }
    return s;
  }, [deckCards]);

  // how many tiles are on screen: "Show more" adds a page, a new search starts over
  const [renderLimit, setRenderLimit] = useState(RENDER_LIMIT);
  useEffect(() => { setRenderLimit(RENDER_LIMIT); }, [list]);
  const shown = useMemo(() => list.slice(0, renderLimit), [list, renderLimit]);

  const deckValid = leader && mainCount === MAIN_MAX;

  // loading screen (keeps the shell + back button while the catalog fetches)
  if (loading) {
    return (
      <div className="sn snp px db">
        <PixelScene kind="ocean" />
        <header className="snp-head db-head">
          <button className="snp-back" title="Back to My Decks" onClick={() => setView("my-decks")}><I n="back" /></button>
          <div className="snp-head-title"><h1>Deck Constructor</h1><span className="sn-kicker">Loading card database…</span></div>
        </header>
        <div className="db-loading"><div className="db-spinner" /><p>Loading the One Piece card database…</p></div>
      </div>
    );
  }

  return (
    <div className="sn snp px db">
      <PixelScene kind="ocean" />
      {/* header */}
      <header className="snp-head db-head has-hero slim" style={{ "--hero-img": 'url("/assets/bg/sec-decks.png")' }}>
        <button className="snp-back" title="Back to My Decks" onClick={() => leaveTo("my-decks")}><I n="back" /></button>
        <div className="snp-head-title">
          <h1>Deck Constructor</h1>
          <span className="sn-kicker">Build your crew</span>
        </div>
        <div className="snp-head-r db-head-r">
          <span className={"db-deckstate" + (deckValid ? " ok" : "")}>{deckValid ? "Deck legal" : (leader ? mainCount + " / 50 cards" : "Pick a leader")}</span>
          <button className="db-import" data-act="deck-import" onClick={() => { setImportErrors([]); setImportOpen(true); }}>
            <I n="copy" size={16} /> Import
          </button>
          <button className="db-save" disabled={!leader || mainCount === 0 || saving} onClick={saveDeck}>
            <I n="save" size={16} /> {saving ? "Saving…" : currentDeckId ? "Save" : "Save Deck"}
          </button>
          <button className="db-import" data-act="deck-play" disabled={!deckValid || !currentDeckId || dirty} onClick={playWithDeck}
            title={!deckValid ? "The deck needs a Leader and 50 cards" : !currentDeckId || dirty ? "Save the deck first" : "Open the Duel Room with this deck"}>
            <I n="play" size={16} /> Play
          </button>
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
          isFav={sel && favorites.has(sel.id)} toggleFav={toggleFav} zoom={setZoomed}
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
              <button className={"db-tool" + (copied ? " ok" : "")} title="Copy decklist" onClick={copyDeck}>
                <I n={copied ? "check" : "copy"} size={16} />
              </button>
              <button className="db-tool" title="Clear deck" onClick={clearDeck}><I n="trash" size={16} /></button>
            </div>
          </div>

          <div className="db-deck-scroll">
            {/* leader row */}
            <div className="db-section-h"><span>Leader</span><span className="db-sec-count">{leader ? 1 : 0} / 1</span></div>
            <div className="db-leader-row">
              {leader
                ? <div className="db-leader-card"><CardTile card={leader} onClick={() => setSel(leader)} onRemove={() => remove(leader)} onHover={() => setSel(leader)} /></div>
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
              ? <div className="db-deck-empty"><I n="cards" size={30} /><p>Left click a card on the right to add it, right click to take it out.<br/>A legal deck has exactly 50 cards.</p></div>
              : <div className="db-deck-grid">
                  {deckCards.map(({ card, n }) => (
                    <CardTile key={card.id} card={card} count={n} mini onClick={(e) => add(card, e.shiftKey ? card.max : 1)} onRemove={() => remove(card)} onHover={() => setSel(card)} />
                  ))}
                </div>}
          </div>

          {/* footer: colors */}
          <div className="db-deck-foot">
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
            <div className="db-curve-box" data-deck-stats>
              <span className="db-foot-label">Cost curve</span>
              <div className="db-curve">
                {deckStats.curve.map((n, cost) => (
                  <span className="db-curve-col" key={cost} title={n + " cards with cost " + cost + (cost === 10 ? " or more" : "")}>
                    <i style={{ height: Math.min(100, n * 5) + "%" }} />
                    <b>{n || ""}</b>
                    <small>{cost === 10 ? "10+" : cost}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="db-deck-counts">
              <span>Characters <b>{deckStats.C}</b></span>
              <span>Events <b>{deckStats.E}</b></span>
              <span>Stages <b>{deckStats.S}</b></span>
              <span>+1000 <b>{deckStats.c1000}</b></span>
              <span>+2000 <b>{deckStats.c2000}</b></span>
              <span>[Counter] <b>{deckStats.counterEvents}</b></span>
              <span>[Trigger] <b>{deckStats.triggers}</b></span>
            </div>
          </div>
        </section>

        {/* RIGHT — card list */}
        <section className="db-list">
          <div className="db-list-tabs">
            <button className={"db-tab" + (activeTab === "list" ? " active" : "")} onClick={() => setActiveTab("list")}><I n="cards" size={15} /> Card List</button>
            <button className={"db-tab" + (activeTab === "favs" ? " active" : "")} onClick={() => setActiveTab("favs")}><I n="star" size={15} /> Favorites {favorites.size > 0 && <span className="db-adv-badge">{favorites.size}</span>}</button>
            <button className="db-tab" onClick={() => leaveTo("my-decks")}><I n="save" size={15} /> My Decks</button>
          </div>
          <div className="db-search">
            <I n="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code, type or text…" aria-label="Search cards" />
          </div>
          <div className="db-search db-archetype">
            <I n="friends" size={16} />
            <input value={archetype} list="db-archetypes" data-archetype-filter aria-label="Filter by archetype"
              onChange={(e) => setArchetype(e.target.value)} placeholder="Filter by archetype, e.g. Rocks Pirates…" />
            <datalist id="db-archetypes">
              {archetypes.map((t) => <option key={t} value={t} />)}
            </datalist>
            {archetype && <button className="db-archetype-x" title="Clear archetype" onClick={() => setArchetype("")}>×</button>}
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
            {filtersOn && <button className="db-clearall" data-act="clear-filters" onClick={clearFilters}>Clear all</button>}
            <span className="db-list-count">{list.length} {list.length === 1 ? "card" : "cards"}</span>
          </div>
          {activeTab === "favs" ? (
            <div className="db-list-grid">
              {favorites.size === 0 ? (
                <div className="db-deck-empty" style={{ gridColumn: "1/-1" }}>
                  <I n="star" size={28} />
                  <p>No favorites yet.<br/>Select a card and press “Add to favorites” under it.</p>
                </div>
              ) : (
                pool.filter((c) => favorites.has(c.id)).map((card) => (
                  <CardTile key={card.id} card={card}
                    count={card.t === "L" ? (leader && leader.id === card.id ? 1 : 0) : (deck[card.id] || 0)}
                    dim={card.t !== "L" && (deck[card.id] || 0) >= card.max}
                    locked={card.t !== "L" && !colorOK(card)}
                    onClick={(e) => add(card, e.shiftKey ? card.max : 1)}
                    onRemove={() => remove(card)}
                    onHover={() => setSel(card)} />
                ))
              )}
            </div>
          ) : (
            <div className="db-list-grid">
              {shown.map((card, i) => (
                <React.Fragment key={card.id}>
                  {i === nameHits && <div className="db-list-split" data-text-hits>Found in the card text</div>}
                  <CardTile card={card}
                    count={card.t === "L" ? (leader && leader.id === card.id ? 1 : 0) : (deck[card.id] || 0)}
                    dim={card.t !== "L" && (deck[card.id] || 0) >= card.max}
                    locked={card.t !== "L" && !colorOK(card)}
                    onClick={(e) => add(card, e.shiftKey ? card.max : 1)}
                    onRemove={() => remove(card)}
                    onHover={() => setSel(card)} />
                </React.Fragment>
              ))}
              {list.length > shown.length &&
                <div className="db-list-more">Showing {shown.length} of {list.length} <button className="db-chip" data-act="show-more" onClick={() => setRenderLimit((n) => n + RENDER_LIMIT)}>Show more</button></div>}
            </div>
          )}
        </section>
      </div>

      {/* dock (real counts; header-mounted on narrow screens) */}
      <Dock />

      {/* toast */}
      {toast && <div className="db-toast">{toast}</div>}

      {/* import a decklist */}
      {importOpen &&
        <div className="db-modal-overlay" onClick={() => setImportOpen(false)}>
          <div className="db-modal" onClick={(e) => e.stopPropagation()}>
            <div className="db-modal-head">
              <div className="db-modal-title"><I n="copy" size={18} /> Import Decklist</div>
              <button className="db-modal-x" onClick={() => setImportOpen(false)} title="Close">×</button>
            </div>
            <div className="db-modal-body">
              <div className="db-mod-section">
                <div className="db-mod-label">One card per line, with its code <small>(replaces the deck on screen)</small></div>
                <textarea className="db-import-text" data-import-text autoFocus rows={12} spellCheck={false} value={importText}
                  onChange={(e) => setImportText(e.target.value)} placeholder={"1xOP13-001\n4xOP13-016\n3xST30-004"} />
                {importErrors.length > 0 &&
                  <ul className="db-import-errors" role="alert">
                    {importErrors.map((e) => <li key={e}>{e}</li>)}
                  </ul>}
              </div>
            </div>
            <div className="db-modal-foot">
              <span className="db-mod-result"></span>
              {importPartial && <button className="db-mod-reset" data-act="deck-import-partial" onClick={() => importDeck(true)}>Skip those lines</button>}
              <button className="db-mod-apply" data-act="deck-import-apply" disabled={!importText.trim()} onClick={() => importDeck()}>Import</button>
            </div>
          </div>
        </div>}

      {/* a card at full size, with its text */}
      {zoomed &&
        <div className="db-modal-overlay db-zoom" data-card-zoom onClick={() => setZoomed(null)}>
          <img src={zoomed.image} alt={zoomed.name} />
          <div className="db-zoom-text">
            <b>{zoomed.name}</b> <small>{zoomed.id}</small>
            {zoomed.fx && zoomed.fx !== "-" && <p>{zoomed.fx}</p>}
            {zoomed.trigger && <p>{zoomed.trigger}</p>}
          </div>
        </div>}

      {/* leaving with changes that are not saved */}
      {leaveAsk &&
        <div className="db-modal-overlay" data-unsaved onClick={() => setLeaveAsk(null)}>
          <div className="db-modal" onClick={(e) => e.stopPropagation()}>
            <div className="db-modal-head"><div className="db-modal-title"><I n="save" size={18} /> Unsaved changes</div></div>
            <div className="db-modal-body"><p>“{deckName}” has changes that are not saved.</p></div>
            <div className="db-modal-foot">
              <button className="db-mod-reset" data-act="unsaved-stay" onClick={() => setLeaveAsk(null)}>Keep editing</button>
              <button className="db-mod-reset" data-act="unsaved-discard" onClick={() => setView(leaveAsk)}>Discard</button>
              <button className="db-mod-apply" data-act="unsaved-save" disabled={!leader || mainCount === 0 || saving}
                onClick={async () => { if (await saveDeck()) setView(leaveAsk); }}>Save</button>
            </div>
          </div>
        </div>}

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
                <div className="db-mod-label">Cost <small>(Characters, Events and Stages)</small></div>
                <div className="db-mod-chips">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button key={n} className={"db-chip" + (costF.includes(n) ? " on" : "")} onClick={() => toggleCost(n)}>{n === 10 ? "10+" : n}</button>
                  ))}
                </div>
              </div>
              <div className="db-mod-section db-mod-selects">
                <label>Set <Select value={setF} onChange={setSetF} options={["Any", ...options.sets]} /></label>
                <label>Power <Select value={powerF} onChange={setPowerF} options={["Any", ...options.powers]} /></label>
                <label>Rarity <Select value={rarityF} onChange={setRarityF} options={["Any", ...options.rarities]} /></label>
                <label>Attribute <Select value={attrF} onChange={setAttrF} options={["Any", ...options.attrs]} /></label>
              </div>
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

export { DeckBuilder as DeckBuilderPage };
