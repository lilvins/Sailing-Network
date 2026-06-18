/* ===========================================================
   Sailing Network — My Decks (saved decks gallery)
   Select / rename / delete saved decks. Persists to localStorage.
   Exports window.MyDecks
   =========================================================== */
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
const HUE_NAME = { R:"Red", G:"Green", B:"Blue", P:"Purple", K:"Black", Y:"Yellow" };
const hueColor = (h) => HUE[h] || "#3a4a5e";

const SEED = [
  { id:1, name:"Red Shanks Aggro",      leader:["Shanks","R"],     count:50, format:"OP16", updated:"2h ago",  w:312, l:226, fav:true },
  { id:2, name:"Purple Luffy Ramp",     leader:["Luffy","P"],      count:50, format:"OP16", updated:"yesterday", w:88,  l:41 },
  { id:3, name:"Black/Yellow Luffy",    leader:["Luffy","K"],      count:50, format:"OP15", updated:"3d ago",  w:54,  l:39 },
  { id:4, name:"Green Uta Tempo",       leader:["Uta","G"],        count:47, format:"OP16", updated:"5d ago",  w:12,  l:15 },
  { id:5, name:"Blue Doflamingo Ctrl",  leader:["Doflamingo","B"], count:50, format:"OP16", updated:"1w ago",  w:140, l:96 },
  { id:6, name:"Yellow Katakuri",       leader:["Katakuri","Y"],   count:50, format:"OP15", updated:"2w ago",  w:201, l:170 },
  { id:7, name:"Wano Zoro (testing)",   leader:["Zoro","G"],       count:38, format:"OP16", updated:"3w ago",  w:3,   l:7 },
];

function load() {
  try { const r = localStorage.getItem("sn-decks"); if (r) return JSON.parse(r); } catch (e) {}
  return SEED;
}

function MyDecks() {
  const [decks, setDecks] = useState(load);
  const [renaming, setRenaming] = useState(null);   // deck id
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(null);      // deck pending delete
  const [toast, setToast] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { try { localStorage.setItem("sn-decks", JSON.stringify(decks)); } catch (e) {} }, [decks]);
  useEffect(() => { if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [renaming]);

  const flash = (msg) => { setToast(msg); clearTimeout(window.__mdT); window.__mdT = setTimeout(() => setToast(null), 1900); };

  const startRename = (d) => { setRenaming(d.id); setDraft(d.name); };
  const commitRename = () => {
    const name = draft.trim();
    if (renaming != null && name) { setDecks((ds) => ds.map((d) => d.id === renaming ? { ...d, name } : d)); flash("Deck renamed"); }
    setRenaming(null);
  };
  const doDelete = () => {
    if (!confirm) return;
    setDecks((ds) => ds.filter((d) => d.id !== confirm.id));
    flash("“" + confirm.name + "” deleted");
    setConfirm(null);
  };
  const duplicate = (d) => {
    const id = Math.max(0, ...decks.map((x) => x.id)) + 1;
    setDecks((ds) => { const i = ds.findIndex((x) => x.id === d.id); const copy = { ...d, id, name: d.name + " (copy)", updated: "just now", fav: false }; const n = [...ds]; n.splice(i + 1, 0, copy); return n; });
    flash("Deck duplicated");
  };

  return (
    <div className="snp md">
      <header className="snp-head">
        <a className="snp-back" href="Deck Constructor.html" title="Back to Deck Constructor"><I n="back" /></a>
        <div className="snp-head-title">
          <h1>My Decks</h1>
          <span className="sn-kicker">{decks.length} saved {decks.length === 1 ? "deck" : "decks"}</span>
        </div>
        <div className="snp-head-r">
          <a className="md-new" href="Deck Constructor.html"><I n="plus" size={17} /> New Deck</a>
        </div>
      </header>

      <div className="snp-body"><div className="snp-wrap">
        <div className="md-grid">
          {/* create-new tile */}
          <a className="md-deck md-create" href="Deck Constructor.html">
            <div className="md-create-plus"><I n="plus" size={30} /></div>
            <div className="md-create-label">Create New Deck</div>
            <div className="md-create-sub">Start from a blank slate</div>
          </a>

          {decks.map((d) => {
            const c = hueColor(d.leader[1]);
            const legal = d.count === 50;
            return (
              <div className={"md-deck" + (d.fav ? " fav" : "")} key={d.id}>
                {/* banner */}
                <a className="md-banner" href="Deck Constructor.html" style={{ "--cc": c }} title={"Open " + d.name}>
                  <span className="md-banner-glow" style={{ background:`radial-gradient(120% 90% at 30% 10%, ${c}ee, ${c}66 46%, #0a0f17 88%)` }}></span>
                  <span className="md-leader-emblem">{d.leader[0][0]}</span>
                  {d.fav && <span className="md-fav" title="Favorite">★</span>}
                  <span className="md-open"><I n="play" size={14} /> Open</span>
                </a>
                {/* body */}
                <div className="md-body">
                  {renaming === d.id
                    ? <input ref={inputRef} className="md-rename-input" value={draft}
                        onChange={(e) => setDraft(e.target.value)} onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }} />
                    : <div className="md-name" title={d.name}>{d.name}</div>}
                  <div className="md-meta">
                    <span className="md-leadname"><span className="md-dot" style={{ background: c }}></span>{HUE_NAME[d.leader[1]]} {d.leader[0]}</span>
                  </div>
                  <div className="md-stats">
                    <span className={"md-count" + (legal ? " ok" : "")}>{legal ? <I n="check" size={12} /> : null}{d.count}/50</span>
                    <span className="md-wl"><b className="w">{d.w}W</b> · <b className="l">{d.l}L</b></span>
                    <span className="md-updated">{d.updated}</span>
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
      </div></div>

      {/* dock */}
      <div className="snp-dock">
        <a className="snp-iconbtn" href="#" title="Messages"><I n="chat" /><span className="snp-dock-badge">3</span></a>
        <a className="snp-iconbtn" href="#" title="Friends online"><I n="friends" /></a>
      </div>

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

window.MyDecks = MyDecks;
