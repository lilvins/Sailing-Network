const { useState, useRef, useEffect, useCallback } = React;

/* ---------- tweak defaults ---------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "layout": "screenshot",
  "showLabels": true,
  "boardSize": 100,
  "accent": "#e23b32",
  "felt": "#13222b",
  "cardBack": "#1b2440"
} /*EDITMODE-END*/;

let _id = 100;
const nid = () => ++_id;
const newCard = () => ({ id: nid() });
const newHand = (n = 5) => Array.from({ length: n }, newCard);

/* ---------- card visuals ---------- */
function Card({ kind = "front", card, label, selected, selectable, rested, mini, draggable, onClick, onDragStart, onDragEnd, count, style }) {
  const cls = ["card", kind];
  if (selected) cls.push("selected");
  if (selectable) cls.push("selectable");
  if (rested) cls.push("rested");
  if (mini) cls.push("mini");
  const base = mini ? { width: 52, height: 72, fontSize: 18 } : {};
  const merged = { ...base, ...(style || {}) };
  return (
    <div
      className={cls.join(" ")}
      style={merged}
      draggable={draggable || undefined}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}>
      
      {kind === "front" && (label ? label : <div className="pip"></div>)}
      {kind === "don" && "•"}
      {kind === "leader" && (label || "LEADER")}
      {count != null && <span className="count">{count}</span>}
    </div>);

}

/* ---------- empty drop / tap slot ---------- */
function Slot({ label, onClick, onDrop, onDragOver, onDragLeave, over }) {
  return (
    <div
      className={"slot" + (over ? " drop-ok" : "")}
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}>
      {label}</div>);

}

/* ---------- vertical stack of horizontal (landscape) life cards ---------- */
function LifeStack({ n, selected, onClick }) {
  return (
    <div className={"life-stack" + (onClick ? " selectable" : "") + (selected ? " sel" : "")} onClick={onClick}>
      {Array.from({ length: n }, (_, i) => <div key={i} className="card back life-card"></div>)}
    </div>);

}

/* ---------- fixed-width hand: cards spread, overlapping more as count grows ---------- */
const HAND_CARD = 68;
const HAND_MAX_STEP = 160; // generous spread — self-measuring fan fills to column width

function HandFan({ cards, faceUp, selected, onSelect, makeDragStart, onDragEnd, handRef, onDragOver, onDrop, over }) {
  const containerRef = React.useRef(null);
  const [w, setW] = React.useState(200);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setW(el.offsetWidth || 200);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, []);
  const n = cards.length;
  const step = n > 1 ? Math.min(HAND_MAX_STEP, (w - HAND_CARD) / (n - 1)) : 0;
  const used = HAND_CARD + step * Math.max(0, n - 1);
  const startX = (w - used) / 2;
  return (
    <div className={"hand-fan" + (over ? " over" : "")}
    ref={(el) => { containerRef.current = el; if (handRef) handRef.current = el; }}
    style={{ width: '100%' }} onDragOver={onDragOver} onDrop={onDrop}>
      {n === 0 && <span className="hand-empty">Hand empty — tap the Deck to draw</span>}
      {cards.map((c, i) =>
      <Card key={c.id} kind={faceUp ? "front" : "back"}
      style={{ position: "absolute", left: Math.round(startX + i * step), bottom: 0, zIndex: i + 1 }}
      draggable={faceUp || undefined}
      selectable={faceUp || undefined}
      selected={faceUp && selected === c.id}
      onClick={faceUp ? () => onSelect(c.id) : undefined}
      onDragStart={faceUp ? makeDragStart(c.id) : undefined}
      onDragEnd={onDragEnd} />
      )}
    </div>);

}

/* ---------- leader: framed image-slot the user fills with real art ---------- */
function LeaderCard({ slotId, placeholder }) {
  return (
    <div className="card leader">
      <image-slot id={slotId} shape="rounded" radius="7" placeholder={placeholder}></image-slot>
    </div>);

}

/* ---------- a labelled zone column with mini caption ---------- */
function ZCol({ caption, children, showCaption }) {
  return (
    <div className="zcol" style={{ position: "relative" }}>
      {showCaption && <div className="mini-label">{caption}</div>}
      {children}
    </div>);

}

/* ================= APP ================= */
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [hand, setHand] = useState(() => newHand(5));
  const [chars, setChars] = useState([null, null, null, null, null]);
  const [stage, setStage] = useState(null);
  const [cost, setCost] = useState(() => Array.from({ length: 4 }, () => ({ id: nid(), rested: false })));
  const [donDeck, setDonDeck] = useState(6);
  const [deck, setDeck] = useState(45);
  const [life, setLife] = useState(5);
  const [trash, setTrash] = useState(2);

  const [selected, setSelected] = useState(null);
  const [over, setOver] = useState(null); // zone key currently hovered while dragging
  const dragId = useRef(null);

  const [muted, setMuted] = useState(false);
  const [sound, setSound] = useState(true);
  const [music, setMusic] = useState(true);
  const [chat, setChat] = useState([
  { who: "Opponent", body: "Leader is Monkey D. Luffy", tag: "ST13-003" },
  { sys: "Attempting to connect to TKMDHK" },
  { sys: "Version is 1.21b" },
  { who: "Pirate35412514", body: "Leader is Queen", tag: "OP04-040" },
  { sys: "SS Has Connected" },
  { sys: "Version is 1.21b" },
  { who: "SS", body: "Leader is Charlotte Katakuri", tag: "OP03-099" },
  { who: "Pirate35412514", body: "Chose to go First" }]
  );
  const [draft, setDraft] = useState("");
  const logRef = useRef(null);

  const [toasts, setToasts] = useState([]);

  /* ----- scale the fixed-size mat to fit the centre column ----- */
  const centerRef = useRef(null);
  const matRef = useRef(null);
  const [fit, setFit] = useState(0.6);
  useEffect(() => {
    const compute = () => {
      const el = centerRef.current,m = matRef.current;
      if (!el || !m) return;
      const r = el.getBoundingClientRect();
      const mw = m.offsetWidth,mh = m.offsetHeight;
      if (!r.width || !r.height || !mw || !mh) return;
      const s = Math.min((r.width - 6) / mw, (r.height - 6) / mh);
      setFit(Math.max(0.2, Math.min(1.7, s)));
    };
    compute();
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      if (centerRef.current) ro.observe(centerRef.current);
      if (matRef.current) ro.observe(matRef.current);
    }
    window.addEventListener("resize", compute);
    const id1 = setTimeout(compute, 150);
    const id2 = setTimeout(compute, 500);
    return () => {if (ro) ro.disconnect();window.removeEventListener("resize", compute);clearTimeout(id1);clearTimeout(id2);};
  }, []);
  const toast = useCallback((msg) => {
    const id = nid();
    setToasts((ts) => [...ts, { id, msg }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 1800);
  }, []);

  useEffect(() => {if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;}, [chat]);

  /* ----- drag/drop ----- */
  const startDrag = (id) => (e) => {dragId.current = id;e.dataTransfer.effectAllowed = "move";e.dataTransfer.setData("text/plain", String(id));};
  const endDrag = () => {dragId.current = null;setOver(null);};
  const allowDrop = (key) => (e) => {if (dragId.current != null) {e.preventDefault();setOver(key);}};
  const leaveDrop = () => setOver(null);

  const placeFromHand = (apply) => {
    const id = dragId.current;
    if (id == null) return;
    const c = hand.find((x) => x.id === id);
    if (!c) return;
    apply(c);
    setHand((h) => h.filter((x) => x.id !== id));
    dragId.current = null;setOver(null);
  };

  const dropChar = (i) => (e) => {
    e.preventDefault();
    placeFromHand((c) => setChars((cs) => {if (cs[i]) return cs;const n = [...cs];n[i] = c;return n;}));
  };
  const dropStage = (e) => {
    e.preventDefault();
    if (stage) {setOver(null);return;}
    placeFromHand((c) => setStage(c));
  };

  /* ----- reorder within the hand (drag a hand card over the hand) ----- */
  const handRef = useRef(null);
  const overHand = (e) => {if (dragId.current != null) {e.preventDefault();setOver("hand");}};
  const reorderHand = (e) => {
    e.preventDefault();
    const id = dragId.current;
    setOver(null);
    if (id == null || !handRef.current) return;
    const from = hand.findIndex((c) => c.id === id);
    if (from < 0) return; // not a hand card (came from elsewhere)
    const els = [...handRef.current.querySelectorAll(".card")];
    let to = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {to = i;break;}
    }
    setHand((h) => {
      const n = [...h];
      const [c] = n.splice(from, 1);
      let t = from < to ? to - 1 : to;
      t = Math.max(0, Math.min(n.length, t));
      n.splice(t, 0, c);
      return n;
    });
    dragId.current = null;
  };

  /* ----- taps ----- */
  const drawCard = () => {if (deck <= 0) return;setDeck((d) => d - 1);setHand((h) => [...h, newCard()]);toast("Drew a card");};
  const tapDonDeck = () => {if (donDeck <= 0) return;setDonDeck((d) => d - 1);setCost((c) => [...c, { id: nid(), rested: false }]);toast("Added a DON!! to cost area");};
  const placeIntoChar = (i) => () => {if (chars[i]) return;setChars((cs) => {const n = [...cs];n[i] = newCard();return n;});toast("Placed a card");};
  const placeIntoStage = () => {if (stage) return;setStage(newCard());toast("Placed a stage card");};
  const toggleDon = (id) => () => setCost((c) => c.map((d) => d.id === id ? { ...d, rested: !d.rested } : d));
  const tapTrash = () => toast("Trash: " + trash + " card" + (trash === 1 ? "" : "s"));

  const sel = (id) => () => setSelected((s) => s === id ? null : id);

  /* ----- chat ----- */
  const send = () => {const v = draft.trim();if (!v) return;setChat((c) => [...c, { who: "You", body: v }]);setDraft("");};

  /* ----- mulligan ----- */
  const mulligan = () => {setHand(newHand(5));setChars([null, null, null, null, null]);setStage(null);toast("Mulligan — redrew opening hand");};
  const keep = () => toast("Kept opening hand");

  const showLabels = t.showLabels;

  /* root css vars from tweaks */
  const rootVars = {
    "--accent": t.accent,
    "--felt": t.felt,
    "--card-back": t.cardBack
  };

  /* ================= opponent static half ================= */
  const oppBacks = (n) => Array.from({ length: n }, (_, i) => <Card key={i} kind="back" />);
  const OppHalf =
  <div className="half opp">
      {/* character band (closest to centre) */}
      <div className="band" style={{ flex: 1.25, alignItems: "center" }}>
        <div className="zone tint field" style={{ flex: 1, minHeight: 460, padding: "22px 16px" }}>
          {showLabels && <div className="label">Character Area</div>}
          <div className="char-row">
            <Card kind="back" /><Card kind="back" />
          </div>
        </div>
      </div>
      {/* middle band: leader centred, life stack left, stage+deck right */}
      <div className="band" style={{ flex: 1.1, alignItems: "center" }}>
        <div className="mid-grid">
          <div className="mid-left">
            <ZCol caption="Life" showCaption={showLabels}><LifeStack n={5} /></ZCol>
          </div>
          <div className="mid-center">
            <ZCol caption="Leader" showCaption={showLabels}><LeaderCard slotId="leader-opp" placeholder="Queen" /></ZCol>
          </div>
          <div className="mid-right">
            <ZCol caption="Stage" showCaption={showLabels}><div className="slot">STAGE</div></ZCol>
            <ZCol caption="Deck" showCaption={showLabels}><Card kind="back" count={43} /></ZCol>
          </div>
        </div>
      </div>
      {/* cost band: don deck / cost area / trash */}
      <div className="band" style={{ flex: 1.2, alignItems: "center", gap: 8 }}>
        <ZCol caption="DON Deck" showCaption={showLabels}><Card kind="don" count={5} /></ZCol>
        <div className="zone tint" style={{ flex: 1, minHeight: 150, padding: "12px 10px" }}>
          {showLabels && <div className="label">Cost Area</div>}
          <div className="cost-row" style={{ justifyContent: "center" }}>
            <Card kind="don" /><Card kind="don" /><Card kind="don" /><Card kind="don" /><Card kind="don" />
          </div>
        </div>
        <ZCol caption="Trash" showCaption={showLabels}><Card kind="back" count={1} /></ZCol>
      </div>
    </div>;


  /* ================= your interactive half ================= */
  const YouHalf =
  <div className="half you">
      {/* character band (closest to centre) */}
      <div className="band" style={{ flex: 1.25, alignItems: "center" }}>
        <div className="zone tint field" style={{ flex: 1, minHeight: 460, padding: "22px 16px" }}>
          {showLabels && <div className="label">Character Area</div>}
          <div className="char-row">
            {chars.map((c, i) => c ?
          <Card key={c.id} kind="front" selectable selected={selected === c.id} onClick={sel(c.id)} /> :
          <Slot key={i} label="+" over={over === "char" + i}
          onClick={placeIntoChar(i)} onDrop={dropChar(i)}
          onDragOver={allowDrop("char" + i)} onDragLeave={leaveDrop} />
          )}
          </div>
        </div>
      </div>
      {/* middle band: leader centred, life stack left, stage+deck right */}
      <div className="band" style={{ flex: 1.1, alignItems: "center" }}>
        <div className="mid-grid">
          <div className="mid-left">
            <ZCol caption="Life" showCaption={showLabels}>
              <LifeStack n={life} selected={selected === "life"} onClick={sel("life")} />
            </ZCol>
          </div>
          <div className="mid-center">
            <ZCol caption="Leader" showCaption={showLabels}>
              <LeaderCard slotId="leader-you" placeholder="Katakuri" />
            </ZCol>
          </div>
          <div className="mid-right">
            <ZCol caption="Stage" showCaption={showLabels}>
              {stage ?
            <Card kind="front" selectable selected={selected === stage.id} onClick={sel(stage.id)} /> :
            <Slot label="STAGE" over={over === "stage"} onClick={placeIntoStage}
            onDrop={dropStage} onDragOver={allowDrop("stage")} onDragLeave={leaveDrop} />}
            </ZCol>
            <ZCol caption="Deck" showCaption={showLabels}>
              <Card kind="back" count={deck} selectable onClick={drawCard} />
            </ZCol>
          </div>
        </div>
      </div>
      {/* cost band: don deck / cost area / trash */}
      <div className="band" style={{ flex: 1.2, alignItems: "center", gap: 8 }}>
        <ZCol caption="DON Deck" showCaption={showLabels}>
          <Card kind="don" count={donDeck} selectable onClick={tapDonDeck} />
        </ZCol>
        <div className="zone tint" style={{ flex: 1, minHeight: 150, padding: "12px 10px" }}>
          {showLabels && <div className="label">Cost Area</div>}
          <div className="cost-row">
            {cost.map((d) =>
          <Card key={d.id} kind="don" rested={d.rested} selectable onClick={toggleDon(d.id)} />
          )}
          </div>
        </div>
        <ZCol caption="Trash" showCaption={showLabels}>
          <Card kind="back" count={trash} selectable onClick={tapTrash} />
        </ZCol>
      </div>
    </div>;


  /* ================= hands ================= */
  const oppHand =
  <div className="panel hand" style={{ fontSize: "12px" }}>
      <HandFan cards={Array.from({ length: 5 }, (_, i) => ({ id: "opp" + i }))} faceUp={false} />
    </div>;

  const youHand =
  <div className="panel hand">
      <HandFan
      cards={hand} faceUp={true}
      selected={selected} onSelect={(id) => setSelected((s) => s === id ? null : id)}
      makeDragStart={startDrag} onDragEnd={endDrag}
      handRef={handRef} onDragOver={overHand} onDrop={reorderHand} over={over === "hand"} />
    </div>;


  const centered = t.layout === "centered";

  return (
    <div className={"app" + (centered ? " layout-centered" : "")} style={rootVars}>
      {/* ---- LEFT COLUMN (hands only) ---- */}
      <div className="col col-left">
        {oppHand}
        {youHand}
      </div>

      {/* ---- CENTER MAT ---- */}
      <div className="col col-center" ref={centerRef}>
        <div className="mat" ref={matRef} style={{ transform: `translate(-50%, -50%) scale(${fit * t.boardSize / 100})` }}>
          {OppHalf}
          {YouHalf}
        </div>
      </div>

      {/* ---- RIGHT COLUMN (chat + controls) ---- */}
      <div className="col col-right">
        <div className="panel chat">
          <div className="chat-top">
            <button className="btn small" onClick={() => toast("Call Judge — request sent")}>Call Judge</button>
          </div>
          <div className="chat-log" ref={logRef}>
            {chat.map((m, i) =>
            <div key={i}>
                {m.sys ?
              <span className="sys">{m.body || m.sys}</span> :
              <span><span className="who">[{m.who}]</span> {m.body}{m.tag && <span className="tag">{m.tag}</span>}</span>}
              </div>
            )}
          </div>
          <div className="chat-input">
            <input value={draft} placeholder="Enter Chat Message…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="btn small" onClick={send}>Send</button>
          </div>
        </div>
        <div className="mull">
          <button className="btn" onClick={mulligan}>Mulligan</button>
          <button className="btn primary" onClick={keep}>Keep</button>
        </div>
        <button className="btn concede" onClick={() => toast("Concede — match forfeited")}>Concede</button>
      </div>

      {centered && <div className="floating-hand opp"><HandFan cards={Array.from({ length: 5 }, (_, i) => ({ id: "fopp" + i }))} faceUp={false} /></div>}
      {centered && <div className="floating-hand you"><HandFan
          cards={hand} faceUp={true}
          selected={selected} onSelect={(id) => setSelected((s) => s === id ? null : id)}
          makeDragStart={startDrag} onDragEnd={endDrag}
          handRef={handRef} onDragOver={overHand} onDrop={reorderHand} over={over === "hand"} /></div>}

      <div className="version">1.21b-1</div>

      {/* toasts */}
      <div className="toast-wrap">
        {toasts.map((tt) => <div key={tt.id} className="toast">{tt.msg}</div>)}
      </div>

      {/* ---- TWEAKS ---- */}
      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakRadio label="Arrangement" value={t.layout}
        options={[{ value: "screenshot", label: "Side panels" }, { value: "centered", label: "Hands centered" }]}
        onChange={(v) => setTweak("layout", v)} />
        <TweakToggle label="Zone labels" value={t.showLabels} onChange={(v) => setTweak("showLabels", v)} />
        <TweakSlider label="Board size" value={t.boardSize} min={70} max={100} step={5} unit="%"
        onChange={(v) => setTweak("boardSize", v)} />
        <TweakSection label="Style" />
        <TweakColor label="Accent" value={t.accent}
        options={["#e23b32", "#e3b24c", "#2f8fe0", "#28c08a", "#a45cff"]}
        onChange={(v) => setTweak("accent", v)} />
        <TweakColor label="Felt" value={t.felt}
        options={["#13222b", "#171b24", "#1c1320", "#0f2018", "#241a12"]}
        onChange={(v) => setTweak("felt", v)} />
        <TweakColor label="Card back" value={t.cardBack}
        options={["#1b2440", "#3a1722", "#10302a", "#23262d"]}
        onChange={(v) => setTweak("cardBack", v)} />
      </TweaksPanel>
    </div>);

}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);