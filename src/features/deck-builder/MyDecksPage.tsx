// @ts-nocheck — ported Claude-design prototype; keep logic verbatim, skip strict typing
/* ===========================================================
   Sailing Network — My Decks (saved decks gallery)
   Now backed by the real API: lists the logged-in captain's decks,
   with leader art/colour resolved from the card database.
   =========================================================== */
import * as React from "react";
import { useUiStore } from "../../app/uiStore";
import { api } from "../../lib/api";
import { loadCardsById } from "../cards/cardsDb";
import { Dock, HeaderDock } from "../profiles/ProfilePages";
import "../home/home.css";
import "../profiles/profiles.css";
import "./mydecks.css";
const { useState, useEffect, useRef } = React;

const MD_ICON = {
  back:"M19 12H5M12 19l-7-7 7-7", edit:"M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  trash:"M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6",
  exit:"M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  plus:"M12 5v14M5 12h14", play:"M5 3l14 9-14 9V3z", copy:"M9 9h11v11H9zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1",
  check:"M20 6L9 17l-5-5", chat:"M21 11.5a8.38 8.38 0 01-9 8.32 8.38 8.38 0 01-3.8-.9L3 20l1.08-4.2A8.38 8.38 0 013 11.5 8.5 8.5 0 0112 3a8.5 8.5 0 019 8.5z",
  friends:"M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  cards:"M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4", crown:"M5 16l-2-9 6 4 3-7 3 7 6-4-2 9zM5 20h14",
};
function I({ n, size=20, sw=1.9 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={MD_ICON[n]}></path></svg>;
}
const HUE = { R:"#c0392b", G:"#1f8a5b", B:"#2a6fdb", P:"#7a3fa0", K:"#2c3138", Y:"#caa023" };
const COLOR_LETTER = { Red:"R", Green:"G", Blue:"B", Purple:"P", Black:"K", Yellow:"Y" };
const hueColor = (h) => HUE[h] || "#3a4a5e";

function relTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24); if (d < 7) return d + "d ago";
  return Math.floor(d / 7) + "w ago";
}

function MyDecks() {
  const setView = useUiStore((s) => s.setView);
  const openDeckBuilder = useUiStore((s) => s.openDeckBuilder);

  const [decks, setDecks] = useState([]);          // raw API decks
  const [cardsById, setCardsById] = useState(null); // Map id -> Card
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(null);   // deck id
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(null);      // deck pending delete
  const [toast, setToast] = useState(null);
  const inputRef = useRef(null);

  const reload = async () => {
    const { decks } = await api.myDecks();
    setDecks(decks);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([api.myDecks(), loadCardsById()])
      .then(([d, map]) => {
        if (!alive) return;
        setDecks(d.decks);
        setCardsById(map);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [renaming]);

  const flash = (msg) => { setToast(msg); clearTimeout(window.__mdT); window.__mdT = setTimeout(() => setToast(null), 1900); };

  const startRename = (d) => { setRenaming(d.id); setDraft(d.name); };
  const commitRename = async () => {
    const name = draft.trim();
    const id = renaming;
    setRenaming(null);
    if (id && name) {
      setDecks((ds) => ds.map((d) => (d.id === id ? { ...d, name } : d)));
      try { await api.updateDeck(id, { name }); flash("Deck renamed"); }
      catch (e) { flash(e?.message || "Rename failed"); reload(); }
    }
  };
  const doDelete = async () => {
    if (!confirm) return;
    const d = confirm; setConfirm(null);
    setDecks((ds) => ds.filter((x) => x.id !== d.id));
    try { await api.deleteDeck(d.id); flash("“" + d.name + "” deleted"); }
    catch (e) { flash(e?.message || "Delete failed"); reload(); }
  };
  const duplicate = async (d) => {
    try {
      await api.createDeck({
        name: d.name + " (copy)",
        leaderId: d.leaderId, leaderName: d.leaderName,
        cards: d.cards, format: d.format, fav: false,
      });
      await reload();
      flash("Deck duplicated");
    } catch (e) { flash(e?.message || "Duplicate failed"); }
  };

  return (
    <div className="sn snp md">
      <header className="snp-head has-hero" style={{ "--hero-img": 'url("/assets/bg/sec-decks.png")' }}>
        <button className="snp-back" title="Back to Main Menu" onClick={() => setView("home")}><I n="back" /></button>
        <div className="snp-head-title">
          <h1>My Decks</h1>
          <span className="sn-kicker">{loading ? "loading…" : `${decks.length} saved ${decks.length === 1 ? "deck" : "decks"}`}</span>
        </div>
        <div className="snp-head-r">
          <button className="md-new" onClick={() => openDeckBuilder(null)}><I n="plus" size={17} /> New Deck</button>
          <HeaderDock />
        </div>
      </header>

      <div className="snp-body"><div className="snp-wrap">
        {loading ? (
          <div className="md-loading">Loading your decks…</div>
        ) : (
        <div className="md-grid">
          {/* create-new tile */}
          <button className="md-deck md-create" onClick={() => openDeckBuilder(null)}>
            <div className="md-create-plus"><I n="plus" size={30} /></div>
            <div className="md-create-label">Create New Deck</div>
            <div className="md-create-sub">Start from a blank slate</div>
          </button>

          {decks.map((d) => {
            const lc = cardsById && cardsById.get(d.leaderId);
            const colors = (lc && lc.colors) || [];
            const c = hueColor(COLOR_LETTER[colors[0]] || "R");
            const count = d.cards.reduce((a, x) => a + (x.count || 0), 0);
            const legal = count === 50;
            const leaderName = d.leaderName || (lc && lc.name) || "Unknown";
            const colorName = colors.join("/") || "—";
            const image = lc && lc.image;
            return (
              <div className={"md-deck" + (d.fav ? " fav" : "")} key={d.id}>
                {/* banner */}
                <button className="md-banner" onClick={() => openDeckBuilder(d.id)} style={{ "--cc": c }} title={"Open " + d.name}>
                  <span className="md-banner-glow" style={{ background:`radial-gradient(120% 90% at 30% 10%, ${c}ee, ${c}66 46%, #0a0f17 88%)` }}></span>
                  {image
                    ? <img className="md-banner-img" src={image} loading="lazy" alt="" draggable={false} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    : <span className="md-leader-emblem">{leaderName[0]}</span>}
                  {d.fav && <span className="md-fav" title="Favorite">★</span>}
                  <span className="md-open"><I n="play" size={14} /> Open</span>
                </button>
                {/* body */}
                <div className="md-body">
                  {renaming === d.id
                    ? <input ref={inputRef} className="md-rename-input" value={draft}
                        onChange={(e) => setDraft(e.target.value)} onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }} />
                    : <div className="md-name" title={d.name}>{d.name}</div>}
                  <div className="md-meta">
                    <span className="md-leadname"><span className="md-dot" style={{ background: c }}></span>{colorName} · {leaderName}</span>
                  </div>
                  <div className="md-stats">
                    <span className={"md-count" + (legal ? " ok" : "")}>{legal ? <I n="check" size={12} /> : null}{count}/50</span>
                    <span className="md-wl"><b className="w">{d.wins}W</b> · <b className="l">{d.losses}L</b></span>
                    <span className="md-updated">{relTime(d.updatedAt)}</span>
                  </div>
                </div>
                {/* actions */}
                <div className="md-actions">
                  <button className="md-act" title="Rename" onClick={() => startRename(d)}><I n="edit" size={15} /></button>
                  <button className="md-act" title="Duplicate" onClick={() => duplicate(d)}><I n="copy" size={15} /></button>
                  <button className="md-act danger" title="Delete" onClick={() => setConfirm(d)}><I n="trash" size={15} /></button>
                </div>
              </div>);
          })}
        </div>
        )}
      </div></div>

      {/* dock (real counts; header-mounted on narrow screens) */}
      <Dock />

      {/* delete confirm modal */}
      {confirm &&
        <div className="md-modal-overlay" onClick={() => setConfirm(null)}>
          <div className="md-modal" onClick={(e) => e.stopPropagation()}>
            <div className="md-modal-icon"><I n="trash" size={26} /></div>
            <div className="md-modal-title">Delete this deck?</div>
            <p className="md-modal-text">“<b>{confirm.name}</b>” will be permanently removed. This can’t be undone.</p>
            <div className="md-modal-actions">
              <button className="md-cancel" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="md-confirm" onClick={doDelete}><I n="trash" size={15} /> Delete deck</button>
            </div>
          </div>
        </div>}

      {/* toast */}
      {toast && <div className="md-toast">{toast}</div>}
    </div>);
}

export { MyDecks as MyDecksPage };
