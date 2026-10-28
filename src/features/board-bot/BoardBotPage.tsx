import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { cardArtUrl } from "../cards/cardsDb";
import {
  actionLabel,
  actor,
  attackTargets,
  canAttack,
  describePrompt,
  legalActions,
  power,
  type Action,
  type CardInst,
  type Db,
  type GameState,
  type PlayerState,
  type Seat,
} from "../../optcg/bot";
import { useBotStore, type FirstChoice, type LogLine, type Mode } from "./botStore";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "@fontsource/silkscreen/400.css";
import "./boardbot.css";

/* =============================================================================
   PLAY VS BOT — full rules (optcg-ai engine, every card's effect), against the
   optcg-ai bot (Monte Carlo search, playbooks per meta leader). The engine and
   the bot are the generated src/optcg; this page only renders and forwards
   clicks as engine Actions. Every finished game is saved for learning.
   ========================================================================== */

const LEVEL_LABEL = { casual: "Casual", "pro-fast": "Pro veloce", pro: "Pro" } as const;

/** Uid a legal action is "about" (the card you click to do it). */
function subjectOf(a: Action): number | null {
  switch (a.type) {
    case "play":
    case "activate":
    case "counter":
    case "pick":
      return a.type === "counter" ? a.uid : a.uid;
    case "attachDon":
      return a.target;
    case "attack":
      return a.attacker;
    case "block":
      return a.blocker;
    default:
      return null;
  }
}

function useLegal(game: GameState | null, db: Db | null, humanSeat: Seat, mode: Mode, thinking: boolean): Action[] {
  return useMemo(() => {
    if (!game || !db || mode !== "human" || thinking || game.winner !== null) return [];
    if (actor(game) !== humanSeat) return [];
    return legalActions(db, game);
  }, [game, db, humanSeat, mode, thinking]);
}

export function BoardBotPage() {
  const s = useBotStore();
  useEffect(() => {
    void s.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (s.stage === "loading") return <div className="bb-root bb-center">{s.error ?? "Carico il motore e le carte…"}</div>;
  if (s.stage === "pick") return <PickScreen />;
  return <GameScreen />;
}

// ─── setup ───────────────────────────────────────────────────────────────────

function PickScreen() {
  const s = useBotStore();
  const setView = useUiStore((u) => u.setView);
  const decks = s.bundle?.metaDecks ?? [];
  const learnedLeaders = s.learned ? Object.keys(s.learned.leaders).length : 0;
  return (
    <div className="bb-root bb-pick">
      <div className="bb-pick-panel">
        <div className="bb-eyebrow">Sailing Network · Full rules</div>
        <h1>Play vs Bot</h1>
        <p className="bb-muted">
          Regole complete con gli effetti di tutte le carte. Il bot cerca la mossa simulando la partita in avanti e usa un piano di
          gioco per ogni leader del meta. Ogni partita viene salvata: il bot impara dai risultati.
        </p>
        <div className="bb-form">
          <label>
            <span>Modalità</span>
            <select id="bb-mode" value={s.mode} onChange={(e) => s.setup({ mode: e.target.value as Mode })}>
              <option value="human">Gioca tu contro il bot</option>
              <option value="spectate">Guarda bot contro bot</option>
            </select>
          </label>
          <label>
            <span>{s.mode === "human" ? "Il tuo mazzo" : "Mazzo A"}</span>
            <select id="bb-deck-a" value={s.humanDeck} onChange={(e) => s.setup({ humanDeck: Number(e.target.value) })}>
              {decks.map((d, i) => (
                <option key={d.leader + i} value={i}>
                  {d.name} — {d.pop}% del meta
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{s.mode === "human" ? "Mazzo del bot" : "Mazzo B"}</span>
            <select id="bb-deck-b" value={s.botDeck} onChange={(e) => s.setup({ botDeck: Number(e.target.value) })}>
              {decks.map((d, i) => (
                <option key={d.leader + i} value={i}>
                  {d.name} — {d.pop}% del meta
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Livello del bot</span>
            <select id="bb-level" value={s.level} onChange={(e) => s.setup({ level: e.target.value as typeof s.level })}>
              <option value="casual">Casual — regole semplici, istantaneo</option>
              <option value="pro-fast">Pro veloce — ricerca breve</option>
              <option value="pro">Pro — ricerca completa (~0,5 s a mossa)</option>
            </select>
          </label>
          {s.mode === "human" && (
            <label>
              <span>Chi inizia</span>
              <select id="bb-first" value={s.first} onChange={(e) => s.setup({ first: e.target.value as FirstChoice })}>
                <option value="random">Tiro di dado</option>
                <option value="human">Io</option>
                <option value="bot">Il bot</option>
              </select>
            </label>
          )}
        </div>
        <div className="bb-row">
          <button className="bb-btn bb-primary" onClick={() => s.start()}>
            {s.mode === "human" ? "Inizia la partita" : "Avvia"}
          </button>
          <button className="bb-btn" onClick={() => setView("home")}>
            Home
          </button>
        </div>
        <p className="bb-fine">
          Motore {s.bundle?.version}. {learnedLeaders ? `Parametri appresi per ${learnedLeaders} leader.` : "Nessun parametro appreso ancora."}
        </p>
      </div>
    </div>
  );
}

// ─── game ────────────────────────────────────────────────────────────────────

function GameScreen() {
  const s = useBotStore();
  const db = s.bundle!.db;
  const game = s.game!;
  const legal = useLegal(game, db, s.humanSeat, s.mode, s.thinking);
  const me = s.mode === "human" ? s.humanSeat : 0;
  const other: Seat = me === 0 ? 1 : 0;

  const bySubject = useMemo(() => {
    const m = new Map<number, Action[]>();
    for (const a of legal) {
      const u = subjectOf(a);
      if (u === null) continue;
      m.set(u, [...(m.get(u) ?? []), a]);
    }
    return m;
  }, [legal]);

  const selectedActions = s.selected !== null ? bySubject.get(s.selected) ?? [] : [];
  const attackFrom = selectedActions.filter((a): a is Extract<Action, { type: "attack" }> => a.type === "attack");
  const attackTargetsSet = new Set(attackFrom.map((a) => a.target));

  function clickCard(inst: CardInst) {
    s.setInspect(inst.id);
    // attack: attacker selected, now the target
    const atk = attackFrom.find((a) => a.target === inst.uid);
    if (atk) return s.play(atk);
    const own = bySubject.get(inst.uid) ?? [];
    // prompts answered by clicking the card
    const direct = own.find((a) => a.type === "pick" || a.type === "block" || a.type === "counter");
    if (direct && game.prompt) return s.play(direct);
    s.select(own.length ? inst.uid : null);
  }

  const cardState = (inst: CardInst) => ({
    actionable: bySubject.has(inst.uid),
    selected: s.selected === inst.uid,
    target: attackTargetsSet.has(inst.uid),
  });

  // buttons in the band: actions of the selected card, then actions not tied to a visible card
  const visible = new Set<number>();
  for (const p of game.players) [p.leader, ...p.chars, ...(p.stage ? [p.stage] : []), ...p.hand].forEach((c) => visible.add(c.uid));
  const loose = legal.filter((a) => {
    const u = subjectOf(a);
    if (a.type === "attack") return false;
    return u === null || !visible.has(u) || (game.view?.cards.includes(u) ?? false);
  });
  const shown = s.selected !== null ? selectedActions.filter((a) => a.type !== "attack" || false) : [];
  const viewCards = game.view && (s.mode === "spectate" || game.view.viewer === me) ? game.view.cards : [];

  return (
    <div className="bb-root bb-game">
      <header className="bb-top">
        <button className="bb-btn bb-small" onClick={() => s.leave()}>
          ← Esci
        </button>
        <div className="bb-title">
          Play vs Bot · {LEVEL_LABEL[s.level]} · Turno {Math.max(1, game.turn)}
        </div>
        <div className={`bb-status${s.thinking ? " bb-thinking" : ""}`}>
          {game.winner !== null
            ? "Partita finita"
            : s.thinking
              ? "Il bot sta pensando…"
              : describePrompt(db, game)}
        </div>
      </header>

      <div className="bb-main">
        <div className="bb-board">
          <Side db={db} game={game} seat={other} top onCard={clickCard} cardState={cardState} hideHand={s.mode === "human"} />
          <div className="bb-band">
            <div className="bb-prompt">{game.winner === null ? describePrompt(db, game) : ""}</div>
            {viewCards.length > 0 && (
              <div className="bb-view">
                {viewCards.map((u) => {
                  const inst = findInst(game, u);
                  return inst ? <Card key={u} db={db} game={game} inst={inst} onClick={() => clickCard(inst)} {...cardState(inst)} small /> : null;
                })}
              </div>
            )}
            <div className="bb-actions">
              {shown.map((a, i) => (
                <button key={"s" + i} className="bb-btn" onClick={() => s.play(a)}>
                  {actionLabel(db, game, a)}
                </button>
              ))}
              {attackFrom.length > 0 && <span className="bb-hint">Scegli il bersaglio dell'attacco</span>}
              {loose.map((a, i) => (
                <button
                  key={"l" + i}
                  className={`bb-btn${a.type === "endTurn" || a.type === "done" ? " bb-primary" : ""}`}
                  onClick={() => s.play(a)}
                >
                  {actionLabel(db, game, a)}
                </button>
              ))}
            </div>
          </div>
          <Side db={db} game={game} seat={me} onCard={clickCard} cardState={cardState} />
        </div>

        <aside className="bb-side">
          <Inspector db={db} id={s.inspect} />
          <Log lines={s.log} humanSeat={s.mode === "human" ? s.humanSeat : null} flagged={s.flagged} onFlag={s.flag} />
        </aside>
      </div>

      {game.winner !== null && <GameOver />}
    </div>
  );
}

function findInst(game: GameState, uid: number): CardInst | null {
  for (const p of game.players)
    for (const c of [p.leader, ...p.chars, ...(p.stage ? [p.stage] : []), ...p.hand, ...p.trash, ...p.deck, ...p.life]) if (c.uid === uid) return c;
  return null;
}

interface SideProps {
  db: Db;
  game: GameState;
  seat: Seat;
  top?: boolean;
  hideHand?: boolean;
  onCard: (c: CardInst) => void;
  cardState: (c: CardInst) => { actionable: boolean; selected: boolean; target: boolean };
}

function Side({ db, game, seat, top, hideHand, onCard, cardState }: SideProps) {
  const p = game.players[seat];
  const [showTrash, setShowTrash] = useState(false);
  const field = (
    <div className="bb-field">
      <div className="bb-leaderslot">
        <Card db={db} game={game} inst={p.leader} onClick={() => onCard(p.leader)} {...cardState(p.leader)} leader />
        {p.stage && <Card db={db} game={game} inst={p.stage} onClick={() => onCard(p.stage!)} {...cardState(p.stage)} />}
      </div>
      <div className="bb-chars">
        {p.chars.map((c) => (
          <Card key={c.uid} db={db} game={game} inst={c} onClick={() => onCard(c)} {...cardState(c)} />
        ))}
        {p.chars.length === 0 && <div className="bb-empty">Nessun personaggio</div>}
      </div>
    </div>
  );
  const piles = (
    <div className="bb-piles">
      <Pile label="Vite" value={p.life.length} hint={p.life.some((c) => c.faceUp) ? `${p.life.filter((c) => c.faceUp).length} scoperte` : undefined} strong />
      <Pile label="Mano" value={p.hand.length} />
      <Pile label="Mazzo" value={p.deck.length} />
      <button className="bb-pile bb-pile-btn" onClick={() => setShowTrash((v) => !v)} aria-expanded={showTrash}>
        <span className="bb-pile-v">{p.trash.length}</span>
        <span className="bb-pile-l">Cimitero</span>
      </button>
      <Don p={p} />
      <div className="bb-who">{p.name}</div>
    </div>
  );
  const hand =
    !hideHand || seat === 0 ? (
      <div className="bb-hand">
        {p.hand.map((c) => (
          <Card key={c.uid} db={db} game={game} inst={c} onClick={() => onCard(c)} {...cardState(c)} small />
        ))}
      </div>
    ) : (
      <div className="bb-hand bb-hand-hidden">{p.hand.map((c) => <div key={c.uid} className="bb-back bb-small-card" />)}</div>
    );
  return (
    <section className={`bb-sideblock${top ? " bb-top-side" : ""}${game.active === seat ? " bb-active" : ""}`}>
      {top ? (
        <>
          {hand}
          {piles}
          {field}
        </>
      ) : (
        <>
          {field}
          {piles}
          {hand}
        </>
      )}
      {showTrash && (
        <div className="bb-trash">
          {p.trash.length === 0 ? <span className="bb-muted">Cimitero vuoto</span> : p.trash.map((c) => <Card key={c.uid} db={db} game={game} inst={c} onClick={() => onCard(c)} {...cardState(c)} small />)}
        </div>
      )}
    </section>
  );
}

function Pile({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className={`bb-pile${strong ? " bb-pile-strong" : ""}`}>
      <span className="bb-pile-v">{value}</span>
      <span className="bb-pile-l">{label}</span>
      {hint && <span className="bb-pile-h">{hint}</span>}
    </div>
  );
}

function Don({ p }: { p: PlayerState }) {
  return (
    <div className="bb-pile bb-don">
      <span className="bb-pile-v">
        {p.donActive}
        <span className="bb-don-r">/{p.donRested}</span>
      </span>
      <span className="bb-pile-l">DON attivi/riposati</span>
      <span className="bb-pile-h">{p.donDeck} nel mazzo DON</span>
    </div>
  );
}

function Card({
  db,
  game,
  inst,
  onClick,
  actionable,
  selected,
  target,
  small,
  leader,
}: {
  db: Db;
  game: GameState;
  inst: CardInst;
  onClick: () => void;
  actionable: boolean;
  selected: boolean;
  target: boolean;
  small?: boolean;
  leader?: boolean;
}) {
  const d = db[inst.id];
  const onField = !small;
  const pw = onField ? power(db, game, inst.uid) : d?.power ?? 0;
  const atk = onField && game.active === inst.owner && canAttack(db, game, inst.uid) && attackTargets(db, game, inst.uid).length > 0;
  const cls = [
    "bb-card",
    small ? "bb-small-card" : "",
    leader ? "bb-leader" : "",
    inst.rested ? "bb-rested" : "",
    actionable ? "bb-actionable" : "",
    selected ? "bb-selected" : "",
    target ? "bb-target" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} onClick={onClick} title={d ? `${d.name} (${d.id})` : inst.id} aria-pressed={selected}>
      <CardImg id={inst.id} name={d?.name ?? inst.id} />
      {onField && d && (d.type === "Character" || d.type === "Leader") && <span className={`bb-power${atk ? " bb-can-attack" : ""}`}>{pw}</span>}
      {inst.don > 0 && <span className="bb-donbadge">+{inst.don} DON</span>}
    </button>
  );
}

/** Card art: self-hosted file, then the server's on-demand proxy, then the name. */
function CardImg({ id, name, className }: { id: string; name: string; className?: string }) {
  const [stage, setStage] = useState(0);
  useEffect(() => setStage(0), [id]);
  if (stage >= 2) return <span className="bb-noart">{name}</span>;
  const src = stage === 0 ? cardArtUrl(id) : `/api/card-art/${id}`;
  return <img className={className} src={src} alt={name} draggable={false} loading="lazy" onError={() => setStage((x) => x + 1)} />;
}

function Inspector({ db, id }: { db: Db; id: string | null }) {
  const d = id ? db[id] : null;
  if (!d) return <div className="bb-inspect bb-muted">Tocca una carta per leggerla.</div>;
  return (
    <div className="bb-inspect">
      <CardImg id={d.id} name={d.name} />
      <div className="bb-inspect-name">
        {d.name} <span className="bb-muted">{d.id}</span>
      </div>
      <div className="bb-inspect-stats">
        {d.type}
        {d.type !== "Leader" ? ` · costo ${d.cost}` : ` · ${d.life} vite`}
        {d.power ? ` · ${d.power}` : ""}
        {d.counter ? ` · counter +${d.counter}` : ""}
      </div>
      <p className="bb-inspect-text">{d.text || "Nessun effetto."}</p>
    </div>
  );
}

function Log({ lines, humanSeat, flagged, onFlag }: { lines: LogLine[]; humanSeat: Seat | null; flagged: number[]; onFlag: (i: number) => void }) {
  return (
    <div className="bb-log" aria-live="polite">
      {[...lines].reverse().map((l, i) => {
        const bot = humanSeat !== null && l.seat !== null && l.seat !== humanSeat;
        return (
          <div key={lines.length - i} className={`bb-logline bb-${l.kind}${bot ? " bb-botline" : ""}`}>
            <span>{bot && l.kind === "action" ? "Bot: " : ""}{l.text}</span>
            {bot && l.kind === "action" && (
              <button className="bb-flag" onClick={() => onFlag(l.actionIndex)} disabled={flagged.includes(l.actionIndex)} title="Segnala come mossa sbagliata">
                {flagged.includes(l.actionIndex) ? "segnalata" : "mossa sbagliata?"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GameOver() {
  const s = useBotStore();
  const game = s.game!;
  const won = s.mode === "human" ? game.winner === s.humanSeat : null;
  return (
    <div className="bb-over" role="dialog" aria-label="Fine partita">
      <div className="bb-over-panel">
        <h2>{won === null ? `Vince ${game.players[game.winner!].name}` : won ? "Hai vinto" : "Ha vinto il bot"}</h2>
        <p className="bb-muted">
          {game.turn} turni. {s.savedId ? "Partita salvata: il bot la userà per imparare." : "Salvo la partita…"}
          {s.flagged.length ? ` ${s.flagged.length} mosse segnalate.` : ""}
        </p>
        <div className="bb-row">
          <button className="bb-btn bb-primary" onClick={() => s.start()}>
            Rivincita
          </button>
          <button className="bb-btn" onClick={() => s.leave()}>
            Cambia mazzi
          </button>
        </div>
      </div>
    </div>
  );
}
