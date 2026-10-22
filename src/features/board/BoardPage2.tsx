import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useGameStore, type SetupInput } from "../../state/gameStore";
import type { CardInstance, GameAction, InstanceId, PlayerState, ZoneId } from "../../state/types";
import { ZONE_IDS } from "../../state/types";
import type { Card } from "../cards/cardsDb";
import { loadCardsById, cardColorHex } from "../cards/cardsDb";
import { api, type Deck } from "../../lib/api";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import {
  CardArt, DonArt, DCard, DropZone, Pile, LogsModal, NewGameScreen,
  ZoneViewer, CtxMenu, fmtAction,
  type QuickAction, type ViewerZone, type CtxState,
} from "./BoardPage";
import "./board.css";
import "./board2.css";

/* =============================================================================
   BOARD v2 — "Play 2", OPTCGSim arrangement with a MINIMAL EDITORIAL identity:
   · flat ivory canvas; white central mat (opponent half warm-gray, rotated
     180°); hairline borders; ink text; ONE red accent (see board2.css)
   · my mat rows: CHARACTER AREA band → [wordmark|LEADER|STAGE|DECK] →
     [DON deck|COST AREA band|TRASH]; life = sideways stack on the mat's left
   · hands in the LEFT corners: opponent's backs top-left, mine bottom-left
   · chat + system log in ONE box, left middle (like the sim)
   · right rail: utility buttons top, giant MULLIGAN/END TURN bottom
   · opponent name + match clock top-center
   Logic = the same gameStore; presentation only.
   ========================================================================== */

// ─── hands (flat rows, anchored to the left corners) ─────────────────────────

function MyHandFlat({ insts, cardMap, onCtx, onHover, quickFor }: {
  insts: CardInstance[];
  cardMap: Map<string, Card>;
  onCtx: (id: InstanceId, x: number, y: number) => void;
  onHover: (card: Card | null) => void;
  quickFor: (inst: CardInstance, zone: ZoneId) => QuickAction[];
}) {
  const n = insts.length;
  // Fixed hand width: the row always occupies ~4.2 card-widths. With few cards
  // they sit almost side by side; the more you draw, the more they overlap
  // (like the real sims) instead of spilling out of the column.
  const step = n > 1 ? Math.min(0.8, 3.2 / (n - 1)) : 1;
  const overlap = `calc(var(--cw) * ${(step - 1).toFixed(3)})`;
  return (
    <DropZone id="hand" className="b2-hand">
      <div className="b2-hand-row">
        {insts.map((inst, i) => (
          <div key={inst.instanceId} className="b2-hand-card" style={{ marginRight: i === n - 1 ? 0 : overlap }}>
            <DCard instanceId={inst.instanceId} inst={inst} card={cardMap.get(inst.cardId)} onCtx={onCtx} onHover={onHover} quick={quickFor(inst, "hand")} />
          </div>
        ))}
        {insts.length === 0 && <span className="b2-hand-empty">Hand empty</span>}
      </div>
    </DropZone>
  );
}

function OppHandFlat({ count = 5 }: { count?: number }) {
  return (
    <div className="b2-opphand">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="b2-opphand-card">
          <div className="gb-back"><span className="gb-back-emblem" /></div>
        </div>
      ))}
    </div>
  );
}

// ─── chat + system log in one box (like OPTCGSim) ────────────────────────────

interface B2ChatMsg { id: string; fromMe: boolean; displayName: string; body: string }

function B2ChatLog({ log }: { log: GameAction[] }) {
  const [messages, setMessages] = useState<B2ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const toBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  useEffect(() => {
    const tick = async () => {
      try {
        const { messages } = await api.chat();
        setMessages(messages.map((m) => ({ id: m.id, fromMe: m.fromMe, displayName: m.displayName, body: m.body })));
        if (atBottom.current) toBottom();
      } catch { /* ignore */ }
    };
    void tick().then(toBottom);
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { if (atBottom.current) toBottom(); }, [log.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      await api.sendChat(body);
      const { messages } = await api.chat();
      setMessages(messages.map((m) => ({ id: m.id, fromMe: m.fromMe, displayName: m.displayName, body: m.body })));
      atBottom.current = true;
      toBottom();
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  };

  return (
    <div className="b2-chatbox">
      <div className="b2-chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {log.map((entry, i) => (
          <div key={`l${i}`} className="b2-sysline">{fmtAction(entry)}</div>
        ))}
        {messages.map((m) => (
          <div key={m.id} className="b2-chatline">
            <b className={m.fromMe ? "me" : ""}>[{m.displayName}]</b> {m.body}
          </div>
        ))}
      </div>
      <div className="b2-chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Enter Chat Message…"
          maxLength={500}
        />
        <button onClick={send} disabled={sending || !draft.trim()}>Send</button>
      </div>
    </div>
  );
}

// ─── my mat (faithful OPTCGSim arrangement) ──────────────────────────────────

function MyMatB2({ player, cardMap, onCtx, onHover, onDonHover, onDetachDon, quickFor }: {
  player: PlayerState;
  cardMap: Map<string, Card>;
  onCtx: (id: InstanceId, x: number, y: number) => void;
  onHover: (card: Card | null) => void;
  onDonHover: (on: boolean) => void;
  onDetachDon: (donId: InstanceId) => void;
  quickFor: (inst: CardInstance, zone: ZoneId) => QuickAction[];
}) {
  const inst = (iid: InstanceId) => player.instances[iid];
  const zone = (z: ZoneId): CardInstance[] => (player.zones[z] ?? []).map(inst).filter(Boolean);

  const chars = zone("characterArea");
  const lifes = zone("life");
  const leaders = zone("leader");
  const stages = zone("stage");
  const deck = zone("deck");
  const donDeck = zone("donDeck");
  const donActive = zone("donActive");
  const trash = zone("trash");

  const donFree = donActive.filter((i) => !i.attachedTo);
  const donGivenTo = (targetId: InstanceId) => donActive.filter((i) => i.attachedTo === targetId);

  return (
    <div className="b2-mat b2-mat-mine">
      {/* life — sideways stack pinned to the mat's left edge */}
      <DropZone id="life" className="b2-life">
        <div className="b2-life-stack">
          {lifes.length === 0 && <div className="b2-side-slot" />}
          {lifes.map((i) => (
            <div className="b2-side-card" key={i.instanceId}>
              <DCard instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} onHover={onHover} />
            </div>
          ))}
          {lifes.length > 0 && <span className="gb-count b2-life-count">{lifes.length}</span>}
        </div>
      </DropZone>

      <div className="b2-mat-rows">
        {/* row 1 — character area band */}
        <DropZone id="characterArea" label="Character Area" className="b2-band b2-chars">
          <div className="b2-chars-row">
            {chars.map((i) => (
              <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} attached={donGivenTo(i.instanceId)} onDetachDon={onDetachDon} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "characterArea")} />
            ))}
          </div>
        </DropZone>

        {/* row 2 — logo | leader | stage | deck */}
        <div className="b2-row2">
          <div className="b2-logo"><span>ONE PIECE</span><small>CARD GAME</small></div>
          <DropZone id="leader" className="b2-slotzone">
            {leaders.map((i) => (
              <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} isLeader attached={donGivenTo(i.instanceId)} onDetachDon={onDetachDon} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "leader")} />
            ))}
            {leaders.length === 0 && <div className="gb-slot" />}
          </DropZone>
          <DropZone id="stage" label="Stage" className="b2-slotzone b2-stageslot">
            {stages.map((i) => (
              <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "stage")} />
            ))}
            {stages.length === 0 && <div className="gb-slot" />}
          </DropZone>
          <DropZone id="deck" className="b2-slotzone">
            <Pile top={deck[0]} count={deck.length} cardMap={cardMap} onCtx={onCtx} empty="Deck" />
          </DropZone>
        </div>

        {/* row 3 — don deck | cost area band | trash */}
        <div className="b2-row3">
          <DropZone id="donDeck" className="b2-slotzone">
            <Pile top={donDeck[0]} count={donDeck.length} cardMap={cardMap} onCtx={onCtx} empty="DON" />
          </DropZone>
          <DropZone id="donActive" label="Cost Area" className="b2-band b2-cost">
            {/* DON: card-sized, uniform, packed left→right at a fixed stride so
                each new DON appears to the right without moving the others */}
            <div className="b2-cost-row">
              {donFree.map((i) => (
                <div key={i.instanceId} className="b2-doncell"
                     onMouseEnter={() => onDonHover(true)} onMouseLeave={() => onDonHover(false)}>
                  <DCard instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} quick={quickFor(i, "donActive")} />
                </div>
              ))}
            </div>
          </DropZone>
          <DropZone id="trash" label="Trash" className="b2-slotzone b2-trashslot">
            <Pile top={trash[trash.length - 1]} count={trash.length} cardMap={cardMap} onCtx={onCtx} onHover={onHover} empty="" />
          </DropZone>
        </div>
      </div>
    </div>
  );
}

/** Opponent mat: same structure, static slots, rotated 180° by CSS. */
function OppMatB2() {
  return (
    <div className="b2-mat b2-mat-opp">
      <div className="b2-rot180">
        <div className="b2-life b2-life-static">
          <div className="b2-life-stack"><div className="b2-side-slot" /></div>
        </div>
        <div className="b2-mat-rows">
          <div className="gb-zone b2-band b2-chars"><span className="gb-zlabel">Character Area</span><div className="b2-chars-row" /></div>
          <div className="b2-row2">
            <div className="b2-logo"><span>ONE PIECE</span><small>CARD GAME</small></div>
            <div className="gb-zone b2-slotzone"><div className="gb-slot" /></div>
            <div className="gb-zone b2-slotzone b2-stageslot"><span className="gb-zlabel">Stage</span><div className="gb-slot" /></div>
            <div className="gb-zone b2-slotzone"><div className="gb-slot" /></div>
          </div>
          <div className="b2-row3">
            <div className="gb-zone b2-slotzone"><div className="gb-slot" /></div>
            <div className="gb-zone b2-band b2-cost"><span className="gb-zlabel">Cost Area</span><div className="b2-cost-row" /></div>
            <div className="gb-zone b2-slotzone b2-trashslot"><span className="gb-zlabel">Trash</span><div className="gb-slot" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── match clock (cosmetic, like the sim's timer) ────────────────────────────

function MatchClock() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return <span className="b2-clock">{mm}:{ss}</span>;
}

// ─── main page ────────────────────────────────────────────────────────────────

export function BoardPage2() {
  const user    = useAuthStore((s) => s.user);
  const setView = useUiStore((s) => s.setView);

  const {
    state, setup, drawCard, drawDon, moveCard, attachDon, refresh,
    shuffleDeck, restCard, declareAttack, rollDie, nextTurn, mulligan, resetGame,
  } = useGameStore();

  const playerId = user?.id ?? "guest";
  const player   = state.players[playerId] ?? null;
  const gameActive = !!player;

  const [cardMap, setCardMap]     = useState<Map<string, Card>>(new Map());
  const [ctx, setCtx]             = useState<CtxState | null>(null);
  const [activeId, setActiveId]   = useState<InstanceId | null>(null);
  const [showNewGame, setShowNewGame] = useState(!gameActive);
  const [zoom, setZoom]           = useState<Card | null>(null);
  const [donZoom, setDonZoom]     = useState(false);
  const [viewer, setViewer]       = useState<ViewerZone | null>(null);
  const [logsOpen, setLogsOpen]   = useState(false);

  const hoverCard = useCallback((c: Card | null) => { setZoom(c); if (c) setDonZoom(false); }, []);
  const hoverDon = useCallback((on: boolean) => { setDonZoom(on); if (on) setZoom(null); }, []);

  useEffect(() => { loadCardsById().then(setCardMap).catch(() => {}); }, []);
  useEffect(() => { if (!gameActive) setShowNewGame(true); }, [gameActive]);

  useEffect(() => {
    if (!ctx) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".gb-ctx")) return;
      setCtx(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [ctx]);

  const instanceToZone = useMemo<Map<InstanceId, ZoneId>>(() => {
    const map = new Map<InstanceId, ZoneId>();
    if (!player) return map;
    for (const z of ZONE_IDS) for (const iid of player.zones[z] ?? []) map.set(iid, z);
    return map;
  }, [player]);

  const quickFor = useCallback((i: CardInstance, z: ZoneId): QuickAction[] => {
    const iid = i.instanceId;
    const mv = (to: ZoneId, toIndex?: number) =>
      moveCard({ playerId, instanceId: iid, from: z, to, toIndex });
    switch (z) {
      case "hand":
        return [
          { label: "Play", run: () => mv("characterArea"), gold: true },
          { label: "Event", run: () => mv("playArea") },
          { label: "Trash", run: () => mv("trash"), danger: true },
        ];
      case "characterArea":
        return [
          ...(!i.rested ? [{ label: "Attack", run: () => declareAttack(playerId, iid), gold: true }] : []),
          { label: i.rested ? "Stand" : "Rest", run: () => restCard(playerId, iid) },
          { label: "K.O.", run: () => mv("trash"), danger: true },
        ];
      case "leader":
        return [
          ...(!i.rested ? [{ label: "Attack", run: () => declareAttack(playerId, iid), gold: true }] : []),
          { label: i.rested ? "Stand" : "Rest", run: () => restCard(playerId, iid) },
        ];
      case "stage":
        return [
          { label: i.rested ? "Stand" : "Rest", run: () => restCard(playerId, iid) },
          { label: "Trash", run: () => mv("trash"), danger: true },
        ];
      case "playArea":
        return [
          { label: "Resolve", run: () => mv("trash"), gold: true },
          { label: "Hand", run: () => mv("hand") },
        ];
      case "donActive": {
        const leaderIid = player?.zones.leader[0];
        return [
          ...(leaderIid ? [{ label: "Give→L", run: () => attachDon(playerId, iid, leaderIid), gold: true }] : []),
          { label: i.rested ? "Stand" : "Rest", run: () => restCard(playerId, iid) },
        ];
      }
      default:
        return [];
    }
  }, [playerId, player, moveCard, restCard, declareAttack, attachDon]);

  const handleStart = useCallback(async (deck: Deck) => {
    if (!deck.leaderId) return;
    const cm = cardMap.size > 0 ? cardMap : await loadCardsById();
    if (cardMap.size === 0) setCardMap(cm);
    const leaderCard = cm.get(deck.leaderId);
    const input: SetupInput = {
      leaderId: deck.leaderId,
      leaderLife: leaderCard?.cost ?? 4,
      main: deck.cards.map((c) => ({ cardId: c.id, count: c.count })),
    };
    setup(playerId, input);
    setShowNewGame(false);
  }, [cardMap, playerId, setup]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as InstanceId);
    setCtx(null);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || !player) return;
    const iid = active.id as InstanceId;
    const fromZone = instanceToZone.get(iid);
    const toZone = over.id as ZoneId;
    if (!fromZone) return;
    const inst = player.instances[iid];
    if (inst?.cardId === "DON" && (toZone === "leader" || toZone === "characterArea")) {
      const target = toZone === "leader" ? player.zones.leader[0] : player.zones.characterArea[0];
      if (target) attachDon(playerId, iid, target);
      return;
    }
    if (fromZone === toZone) return;
    moveCard({ playerId, instanceId: iid, from: fromZone, to: toZone });
  };

  const openCtx = useCallback((instanceId: InstanceId, x: number, y: number) => {
    if (!player) return;
    const zone = instanceToZone.get(instanceId);
    if (!zone) return;
    setCtx({ instanceId, zone, x, y });
  }, [player, instanceToZone]);

  const handleDetachDon = useCallback((donId: InstanceId) => attachDon(playerId, donId, null), [attachDon, playerId]);

  const deckCount = player?.zones.deck.length ?? 0;
  const donLeft   = player?.zones.donDeck.length ?? 0;
  const lifeCount = player?.zones.life.length ?? 0;
  const handInsts = player ? player.zones.hand.map((id) => player.instances[id]).filter(Boolean) : [];
  const playInsts = player ? (player.zones.playArea ?? []).map((id) => player.instances[id]).filter(Boolean) : [];

  const leaderInstId = player?.zones.leader[0];
  const leaderCard   = leaderInstId ? cardMap.get(player!.instances[leaderInstId]?.cardId || "") : undefined;
  const leaderColor  = leaderCard ? cardColorHex(leaderCard) : "#1f8a5b";

  const handleTakeLife = () => {
    if (!player) return;
    const top = player.zones.life[player.zones.life.length - 1];
    if (top) moveCard({ playerId, instanceId: top, from: "life", to: "hand" });
  };
  const handleEndTurn = () => {
    if (!player) return;
    refresh(playerId);
    nextTurn();
  };

  const activeInst = activeId && player ? player.instances[activeId] : null;
  const activeCard = activeInst ? cardMap.get(activeInst.cardId) : undefined;

  return (
    <>
      {showNewGame && (
        <NewGameScreen cardMap={cardMap} onStart={handleStart} onBack={() => (gameActive ? setShowNewGame(false) : setView("home"))} />
      )}

      {gameActive && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="b2-root" style={{ ["--lc" as string]: leaderColor }}>

            {/* top-center: opponent name + match clock */}
            <div className="b2-topname">
              <span className="b2-oppname">Practice Dummy#0000</span>
              <MatchClock />
            </div>

            {/* LEFT column: opp hand / chat+log / my hand */}
            <aside className="b2-left">
              <OppHandFlat count={5} />
              <B2ChatLog log={state.actionLog} />
              <MyHandFlat insts={handInsts} cardMap={cardMap} onCtx={openCtx} onHover={hoverCard} quickFor={quickFor} />
            </aside>

            {/* CENTER: the vertical playmat */}
            <main className="b2-matcol">
              <OppMatB2 />
              <DropZone id="playArea" className="b2-playstrip">
                <div className="b2-play-row">
                  {playInsts.map((i) => (
                    <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={openCtx} onHover={hoverCard} quick={quickFor(i, "playArea")} />
                  ))}
                  {playInsts.length === 0 && <span className="b2-play-hint">— play area —</span>}
                </div>
              </DropZone>
              <MyMatB2 player={player} cardMap={cardMap} onCtx={openCtx} onHover={hoverCard} onDonHover={hoverDon} onDetachDon={handleDetachDon} quickFor={quickFor} />
            </main>

            {/* RIGHT column: parchment utilities + giant actions */}
            <aside className="b2-right">
              <div className="b2-utils">
                <button className="b2-pbtn" onClick={() => setView("home")}>Back to Main</button>
                <button className="b2-pbtn" onClick={() => { resetGame(); setShowNewGame(true); }}>Concede</button>
                <button className="b2-pbtn sm" onClick={() => shuffleDeck(playerId)}>Shuffle Deck</button>
                <button className="b2-pbtn sm" onClick={() => rollDie(playerId, 2)}>Coin Flip</button>
                <button className="b2-pbtn sm" onClick={() => rollDie(playerId, 6)}>Roll D6</button>
                <button className="b2-pbtn sm" onClick={() => setLogsOpen(true)}>Combat Log</button>
              </div>
              <div className="b2-actions">
                <button className="b2-pbtn med" onClick={() => drawCard(playerId)} disabled={deckCount === 0}>Draw ({deckCount})</button>
                <button className="b2-pbtn med" onClick={() => drawDon(playerId)} disabled={donLeft === 0}>DON!! ({donLeft})</button>
                <button className="b2-pbtn med" onClick={handleTakeLife} disabled={lifeCount === 0}>Take Life ({lifeCount})</button>
                <button className="b2-bigbtn" onClick={() => mulligan(playerId)}>Mulligan</button>
                <button className="b2-bigbtn" onClick={handleEndTurn}>End Turn</button>
              </div>
            </aside>

            {/* hover zoom (over the left column, like the sim) */}
            {zoom && (
              <div className="b2-hoverzoom">
                {zoom.image && <img src={zoom.image} alt={zoom.name} draggable={false} />}
                <div className="b2-hz-name">{zoom.name}</div>
                {zoom.effect && <div className="b2-hz-fx">{zoom.effect}</div>}
              </div>
            )}
            {donZoom && !zoom && (
              <div className="b2-hoverzoom">
                <div className="b2-hz-don"><DonArt /></div>
                <div className="b2-hz-name">DON!! CARD</div>
                <div className="b2-hz-fx">Give to your Leader or a Character to add +1000 power, or rest it to pay costs.</div>
              </div>
            )}
          </div>

          <DragOverlay>
            {activeInst && (
              <div className="gb-ghost">
                <CardArt inst={activeInst} card={activeCard} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {ctx && player && (
        <CtxMenu ctx={ctx} player={player} cardMap={cardMap} onOpenViewer={setViewer} onClose={() => setCtx(null)} />
      )}
      {viewer && player && (
        <ZoneViewer zone={viewer} player={player} cardMap={cardMap} onClose={() => setViewer(null)} />
      )}
      {logsOpen && <LogsModal log={state.actionLog} onClose={() => setLogsOpen(false)} />}
    </>
  );
}
