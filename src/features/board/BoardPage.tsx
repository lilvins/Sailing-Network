import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useGameStore, type SetupInput } from "../../state/gameStore";
import type { CardInstance, GameAction, InstanceId, PlayerState, ZoneId } from "../../state/types";
import { ZONE_IDS } from "../../state/types";
import type { Card } from "../cards/cardsDb";
import { loadCardsById, cardColorHex } from "../cards/cardsDb";
import { api, type Deck } from "../../lib/api";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import "./board.css";

/* =============================================================================
   BOARD UI — presentation only. All game logic lives in gameStore (serializable
   actions + actionLog, per CLAUDE.md). Layout follows the official OP playmat:

     [ Life | Characters ......... | Deck  ]
     [ Life | Leader  +  Stage    | Trash ]
     [ DON!! deck | Cost Area ............ ]

   Opponent half mirrored on top (static in practice mode). Hand fanned bottom.
   ========================================================================== */

// ─── Context-menu state ───────────────────────────────────────────────────────

export interface CtxState {
  instanceId: InstanceId;
  zone: ZoneId;
  x: number;
  y: number;
}

// ─── DON!! card art (faithful manga-burst recreation) ─────────────────────────

/** The DON!! card: white field, radiating black focus lines, big ink "ドン!!"
 *  burst and a "Your Turn +1000" bar — modeled on the official DON!! card. */
export function DonArt() {
  const cx = 50, cy = 56, R = 130, rays = 22;
  const wedges: string[] = [];
  for (let k = 0; k < rays; k++) {
    const a0 = (k / rays) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2 / rays) * 0.52; // wedge fill fraction → ray gaps
    const x0 = (cx + Math.cos(a0) * R).toFixed(1), y0 = (cy + Math.sin(a0) * R).toFixed(1);
    const x1 = (cx + Math.cos(a1) * R).toFixed(1), y1 = (cy + Math.sin(a1) * R).toFixed(1);
    wedges.push(`M${cx},${cy} L${x0},${y0} L${x1},${y1} Z`);
  }
  return (
    <svg className="gb-don-art" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-label="DON!! card">
      <rect x="0" y="0" width="100" height="140" fill="#f3f1ec" />
      <g fill="#111">{wedges.map((d, i) => <path key={i} d={d} />)}</g>
      {/* soft white halo so the burst text stays legible over the rays */}
      <ellipse cx="50" cy="56" rx="40" ry="34" fill="#f3f1ec" opacity="0.55" />
      <text className="gb-don-burst-svg" x="49" y="68" textAnchor="middle"
            transform="rotate(-8 49 60)">ドン!!</text>
      <text className="gb-don-sub" x="50" y="92" textAnchor="middle">DON!! CARD</text>
      {/* bottom bar */}
      <rect x="0" y="118" width="100" height="22" fill="#111" />
      <text className="gb-don-turn" x="50" y="128" textAnchor="middle">Your Turn</text>
      <text className="gb-don-plus" x="50" y="137" textAnchor="middle">+1000</text>
    </svg>
  );
}

// ─── Card art renderer ────────────────────────────────────────────────────────

export function CardArt({ inst, card, isLeader = false }: {
  inst: CardInstance;
  card?: Card;
  isLeader?: boolean;
}) {
  if (!inst.faceUp) {
    const isDon = inst.cardId === "DON";
    return <div className={`gb-back${isDon ? " gb-back-don" : ""}${isLeader ? " gb-back-leader" : ""}`}><span className="gb-back-emblem" /></div>;
  }
  if (inst.cardId === "DON") {
    return <DonArt />;
  }
  if (card?.image)
    return <img src={card.image} alt={card.name} className="gb-img" draggable={false} loading="lazy" />;
  return <div className={`gb-back${isLeader ? " gb-back-leader" : ""}`}><span className="gb-back-emblem" /></div>;
}

// ─── Draggable card ───────────────────────────────────────────────────────────

/** A hover quick-action (DuelingBook-style pill shown above the card). */
export interface QuickAction {
  label: string;
  run: () => void;
  danger?: boolean;
  gold?: boolean;
}

export function DCard({
  instanceId,
  inst,
  card,
  isLeader = false,
  attached,
  onDetachDon,
  onCtx,
  onHover,
  quick,
  selected = false,
  onSelect,
}: {
  instanceId: InstanceId;
  inst: CardInstance;
  card?: Card;
  isLeader?: boolean;
  /** DON!! instances given to this card (rendered as a chip on the bottom edge). */
  attached?: CardInstance[];
  onDetachDon?: (donId: InstanceId) => void;
  onCtx: (id: InstanceId, x: number, y: number) => void;
  onHover?: (card: Card | null) => void;
  /** Hover menu actions (shown above the card, CSS-driven on :hover). */
  quick?: QuickAction[];
  /** Selection highlight (DON!! click-to-select flow). */
  selected?: boolean;
  /** Left-click handler: select a DON!!, or assign selected DON!! to this card. */
  onSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: instanceId });
  const style: React.CSSProperties = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0 : 1,
    touchAction: "none",
    zIndex: isDragging ? 60 : undefined,
  };
  const donCount = attached?.length ?? 0;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`gb-card${inst.rested ? " gb-rested" : ""}${isLeader ? " gb-isleader" : ""}${selected ? " gb-selected" : ""}`}
      {...listeners}
      {...attributes}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onCtx(instanceId, e.clientX, e.clientY);
      }}
      onMouseEnter={() => { if (inst.faceUp && card && onHover) onHover(card); }}
      onMouseLeave={() => onHover?.(null)}
    >
      <CardArt inst={inst} card={card} isLeader={isLeader} />
      {inst.marker != null && inst.marker !== 0 && (
        <span className={`gb-marker${inst.marker < 0 ? " neg" : ""}`}>
          {inst.marker > 0 ? `+${inst.marker}` : inst.marker}
        </span>
      )}
      {donCount > 0 && attached && (
        <button
          className="gb-donchip"
          title="Click to return 1 DON!! to the cost area"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDetachDon?.(attached[attached.length - 1].instanceId);
          }}
        >
          DON!!{donCount > 1 ? ` ×${donCount}` : ""}
        </button>
      )}
      {quick && quick.length > 0 && !isDragging && (
        <div className="gb-quick" onPointerDown={(e) => e.stopPropagation()}>
          {quick.map((q) => (
            <button
              key={q.label}
              className={`gb-quick-btn${q.danger ? " danger" : ""}${q.gold ? " gold" : ""}`}
              onClick={(e) => { e.stopPropagation(); q.run(); }}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Zone shells ──────────────────────────────────────────────────────────────

export function DropZone({ id, label, className = "", children }: {
  id: ZoneId;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`gb-zone ${className}${isOver ? " gb-over" : ""}`}>
      {label && <span className="gb-zlabel">{label}</span>}
      {children}
    </div>
  );
}

/** A deck-like pile with depth + count badge. */
export function Pile({ top, count, cardMap, onCtx, onHover, empty }: {
  top?: CardInstance;
  count: number;
  cardMap: Map<string, Card>;
  onCtx: (id: InstanceId, x: number, y: number) => void;
  onHover?: (card: Card | null) => void;
  empty?: string;
}) {
  if (!top) return <div className="gb-slot">{empty && <span className="gb-slot-hint">{empty}</span>}</div>;
  return (
    <div className={`gb-pile${count > 1 ? " gb-pile-deep" : ""}`}>
      <DCard instanceId={top.instanceId} inst={top} card={cardMap.get(top.cardId)} onCtx={onCtx} onHover={onHover} />
      <span className="gb-count">{count}</span>
    </div>
  );
}

// ─── My half — official playmat layout ───────────────────────────────────────

function MyHalf({ player, cardMap, onCtx, onHover, onDetachDon, quickFor, leaderColor, selectedDon, onToggleDon, onAssignDon }: {
  player: PlayerState;
  cardMap: Map<string, Card>;
  onCtx: (id: InstanceId, x: number, y: number) => void;
  onHover: (card: Card | null) => void;
  onDetachDon: (donId: InstanceId) => void;
  quickFor: (inst: CardInstance, zone: ZoneId) => QuickAction[];
  leaderColor: string;
  /** DON!! click-to-select flow */
  selectedDon: Set<InstanceId>;
  onToggleDon: (id: InstanceId) => void;
  onAssignDon: (targetId: InstanceId) => void;
}) {
  const selecting = selectedDon.size > 0;
  const inst = (iid: InstanceId) => player.instances[iid];
  const zone = (z: ZoneId): CardInstance[] => (player.zones[z] ?? []).map(inst).filter(Boolean);

  const chars = zone("characterArea");
  const lifes = zone("life");
  const leaders = zone("leader");
  const stages = zone("stage");
  const plays = zone("playArea");
  const deck = zone("deck");
  const donDeck = zone("donDeck");
  const donActive = zone("donActive");
  const trash = zone("trash");

  // DON!! given to a Leader/Character stay in donActive — split for rendering
  const donFree = donActive.filter((i) => !i.attachedTo);
  const donGivenTo = (targetId: InstanceId) => donActive.filter((i) => i.attachedTo === targetId);

  return (
    <div className={`gb-half gb-half-mine${selecting ? " gb-half-selecting" : ""}`} style={{ ["--lc" as string]: leaderColor }}>
      {/* LEFT — Life (vertical) */}
      <DropZone id="life" label="Life" className="gb-life">
        <div className="gb-life-stack">
          {lifes.length === 0 && <div className="gb-slot gb-slot-life" />}
          {lifes.map((i, k) => (
            <div className="gb-life-card" style={{ ["--i" as string]: k }} key={i.instanceId}>
              <DCard instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} onHover={onHover} />
            </div>
          ))}
          {lifes.length > 0 && <span className="gb-count gb-life-count">{lifes.length}</span>}
        </div>
      </DropZone>

      {/* CENTER — Characters / Leader+Stage / DON row */}
      <div className="gb-center">
        <DropZone id="characterArea" label="Character Area" className="gb-chars">
          <div className="gb-chars-row">
            {chars.map((i) => (
              <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} attached={donGivenTo(i.instanceId)} onDetachDon={onDetachDon} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "characterArea")} onSelect={selecting ? () => onAssignDon(i.instanceId) : undefined} />
            ))}
            {Array.from({ length: Math.max(0, 5 - chars.length) }, (_, k) => (
              <div key={`cs${k}`} className="gb-slot" />
            ))}
          </div>
        </DropZone>

        <div className="gb-lsrow">
          <DropZone id="leader" label="Leader" className="gb-leaderzone">
            {leaders.map((i) => (
              <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} isLeader attached={donGivenTo(i.instanceId)} onDetachDon={onDetachDon} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "leader")} onSelect={selecting ? () => onAssignDon(i.instanceId) : undefined} />
            ))}
            {leaders.length === 0 && <div className="gb-slot" />}
          </DropZone>
          <DropZone id="stage" label="Stage" className="gb-stagezone">
            {stages.map((i) => (
              <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "stage")} />
            ))}
            {stages.length === 0 && <div className="gb-slot" />}
          </DropZone>
          <DropZone id="playArea" label="Play Area" className="gb-playzone">
            <div className="gb-play-row">
              {plays.map((i) => (
                <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} onHover={onHover} quick={quickFor(i, "playArea")} />
              ))}
              {plays.length === 0 && <span className="gb-slot-hint">Events & reveals</span>}
            </div>
          </DropZone>
        </div>

        <div className="gb-donrow">
          <DropZone id="donDeck" label="DON!!" className="gb-dondeck">
            <Pile top={donDeck[0]} count={donDeck.length} cardMap={cardMap} onCtx={onCtx} />
          </DropZone>
          <DropZone id="donActive" label="Cost Area" className="gb-cost">
            <div className="gb-cost-row">
              {donFree.map((i) => (
                <DCard key={i.instanceId} instanceId={i.instanceId} inst={i} card={cardMap.get(i.cardId)} onCtx={onCtx} quick={quickFor(i, "donActive")} selected={selectedDon.has(i.instanceId)} onSelect={() => onToggleDon(i.instanceId)} />
              ))}
              {donActive.length === 0 && <span className="gb-slot-hint">DON!! land here</span>}
              {donActive.length > 0 && donFree.length === 0 && <span className="gb-slot-hint">All DON!! given</span>}
            </div>
          </DropZone>
        </div>
      </div>

      {/* RIGHT — Deck / Trash */}
      <div className="gb-rightcol">
        <DropZone id="deck" label="Deck" className="gb-deckzone">
          <Pile top={deck[0]} count={deck.length} cardMap={cardMap} onCtx={onCtx} empty="—" />
        </DropZone>
        <DropZone id="trash" label="Trash" className="gb-trashzone">
          <Pile top={trash[trash.length - 1]} count={trash.length} cardMap={cardMap} onCtx={onCtx} onHover={onHover} empty="—" />
        </DropZone>
      </div>
    </div>
  );
}

// ─── Opponent half (mirrored, static in practice) ────────────────────────────

function OppHalf() {
  return (
    <div className="gb-half gb-half-opp">
      {/* mirrored: deck/trash on MY left, life on MY right */}
      <div className="gb-rightcol">
        <div className="gb-zone gb-trashzone"><span className="gb-zlabel">Trash</span><div className="gb-slot" /></div>
        <div className="gb-zone gb-deckzone"><span className="gb-zlabel">Deck</span><div className="gb-slot" /></div>
      </div>

      <div className="gb-center">
        <div className="gb-donrow">
          <div className="gb-zone gb-cost"><span className="gb-zlabel">Cost Area</span><div className="gb-cost-row" /></div>
          <div className="gb-zone gb-dondeck"><span className="gb-zlabel">DON!!</span><div className="gb-slot" /></div>
        </div>
        <div className="gb-lsrow">
          <div className="gb-zone gb-playzone"><span className="gb-zlabel">Play Area</span><div className="gb-play-row"><span className="gb-slot-hint">Events & reveals</span></div></div>
          <div className="gb-zone gb-stagezone"><span className="gb-zlabel">Stage</span><div className="gb-slot" /></div>
          <div className="gb-zone gb-leaderzone"><span className="gb-zlabel">Leader</span><div className="gb-slot" /></div>
        </div>
        <div className="gb-zone gb-chars">
          <span className="gb-zlabel">Character Area</span>
          <div className="gb-chars-row">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="gb-slot" />)}
          </div>
        </div>
      </div>

      <div className="gb-zone gb-life">
        <span className="gb-zlabel">Life</span>
        <div className="gb-life-stack"><div className="gb-slot gb-slot-life" /></div>
      </div>
    </div>
  );
}

// ─── Hands ────────────────────────────────────────────────────────────────────

function MyHand({ insts, cardMap, onCtx, onHover, quickFor }: {
  insts: CardInstance[];
  cardMap: Map<string, Card>;
  onCtx: (id: InstanceId, x: number, y: number) => void;
  onHover: (card: Card | null) => void;
  quickFor: (inst: CardInstance, zone: ZoneId) => QuickAction[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "hand" });
  const n = insts.length;
  // fixed fan width: cards overlap progressively as the hand grows
  const step = n > 1 ? Math.min(0.68, 2.72 / (n - 1)) : 1;
  const sideMargin = `calc(var(--cw) * ${((step - 1) / 2).toFixed(3)})`;
  return (
    <div ref={setNodeRef} className={`gb-hand${isOver ? " gb-over" : ""}`}>
      {insts.map((inst, i) => {
        const mid = (n - 1) / 2;
        const off = i - mid;
        return (
          <div
            key={inst.instanceId}
            className="gb-hand-card"
            style={{
              ["--rot" as string]: `${off * Math.min(3.5, 18 / Math.max(1, n))}deg`,
              ["--lift" as string]: `${Math.abs(off) * Math.abs(off) * Math.min(3, 14 / Math.max(1, n))}px`,
              margin: `0 ${sideMargin}`,
            }}
          >
            <DCard instanceId={inst.instanceId} inst={inst} card={cardMap.get(inst.cardId)} onCtx={onCtx} onHover={onHover} quick={quickFor(inst, "hand")} />
          </div>
        );
      })}
      {n === 0 && <span className="gb-hand-empty">Hand empty — drag cards here</span>}
    </div>
  );
}

function OppHand({ count = 5 }: { count?: number }) {
  return (
    <div className="gb-opphand">
      {Array.from({ length: count }, (_, i) => {
        const mid = (count - 1) / 2;
        const off = i - mid;
        return (
          <div key={i} className="gb-opphand-card" style={{ ["--rot" as string]: `${-off * 4}deg` }}>
            <div className="gb-back"><span className="gb-back-emblem" /></div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Hover preview (left panel) ──────────────────────────────────────────────

// ─── Action log ───────────────────────────────────────────────────────────────

export function fmtAction(e: GameAction): string {
  switch (e.type) {
    case "setup":       return "Game started";
    case "drawCard":    return `Drew ${e.count} card${e.count !== 1 ? "s" : ""}`;
    case "drawDon":     return `Drew ${e.count} DON!!`;
    case "moveCard":    return `${e.from} → ${e.to}`;
    case "restCard":    return e.rested ? "Card rested" : "Card stood";
    case "flipCard":    return e.faceUp ? "Card revealed" : "Card turned face-down";
    case "attachDon":   return e.targetId ? "DON!! given" : "DON!! returned";
    case "refresh":     return "Refresh — DON!! returned, all stood";
    case "setMarker":   return e.delta > 0 ? `Power +${e.delta}` : `Power ${e.delta}`;
    case "nextTurn":    return `— Turn ${e.turn} —`;
    case "shuffleDeck": return "Deck shuffled";
    case "attack":      return "⚔ Attack declared";
    case "dieRoll":     return e.sides === 2 ? `Coin flip: ${e.result === 1 ? "Heads" : "Tails"}` : `D${e.sides} roll: ${e.result}`;
    case "mulligan":    return "Mulligan taken";
    default:            return (e as { type: string }).type;
  }
}

export function LogsModal({ log, onClose }: { log: GameAction[]; onClose: () => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="gb-modal-overlay" onClick={onClose}>
      <div className="gb-modal gb-logmodal" onClick={(e) => e.stopPropagation()}>
        <div className="gb-modal-h">
          <span className="gb-modal-title">Action Log</span>
          <span className="gb-modal-sub">{log.length} action{log.length !== 1 ? "s" : ""}</span>
          <button className="gb-modal-x" onClick={onClose} title="Close">×</button>
        </div>
        <div className="gb-log-entries">
          {log.map((entry, i) => (
            <div key={i} className="gb-log-entry">{fmtAction(entry)}</div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

// ─── Card overview (left rail) ───────────────────────────────────────────────

export function CardOverview({ card }: { card: Card | null }) {
  return (
    <div className="gb-panel gb-overview" style={card ? { ["--lc" as string]: cardColorHex(card) } : undefined}>
      <div className="gb-panel-h">Card Overview</div>
      {!card ? (
        <div className="gb-ov-empty">Hover a card to inspect it</div>
      ) : (
        <div className="gb-ov-body">
          {card.image && <img className="gb-ov-img" src={card.image} alt={card.name} draggable={false} />}
          <div className="gb-ov-name">{card.name}</div>
          <div className="gb-ov-line">
            {card.category}
            {card.cost != null ? ` · ${card.category === "Leader" ? "Life" : "Cost"} ${card.cost}` : ""}
            {card.power != null ? ` · ${card.power} pow` : ""}
            {card.counter ? ` · +${card.counter}` : ""}
          </div>
          {card.types?.length > 0 && <div className="gb-ov-types">{card.types.join(" / ")}</div>}
          {card.effect && <div className="gb-ov-fx">{card.effect}</div>}
          {card.trigger && <div className="gb-ov-trigger"><b>Trigger:</b> {card.trigger}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Game chat (right rail — persisted global chat) ──────────────────────────

interface ChatMsg {
  id: string;
  fromMe: boolean;
  displayName: string;
  body: string;
}

export function GameChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
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
    <div className="gb-panel gb-chat">
      <div className="gb-panel-h">Chat</div>
      <div className="gb-chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 && <div className="gb-ov-empty">Say hi to the crew</div>}
        {messages.map((m) => (
          <div className="gb-chat-line" key={m.id}>
            <span className={`gb-chat-name${m.fromMe ? " me" : ""}`}>{m.displayName}:</span> {m.body}
          </div>
        ))}
      </div>
      <div className="gb-chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message…"
          maxLength={500}
        />
        <button onClick={send} disabled={sending || !draft.trim()}>➤</button>
      </div>
    </div>
  );
}

// ─── New game screen ──────────────────────────────────────────────────────────

export function NewGameScreen({ onStart, onBack, cardMap }: {
  onStart: (deck: Deck) => void;
  onBack: () => void;
  cardMap: Map<string, Card>;
}) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.myDecks()
      .then((r) => setDecks(r.decks.filter((d) => d.leaderId && d.cards.length > 0)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const deck = decks.find((d) => d.id === selected);

  return (
    <div className="sn ng-overlay">
      <div className="ng-panel">
        <p className="ng-kicker">Practice Mode</p>
        <p className="ng-title">Choose your deck</p>
        <p className="ng-sub">Solo board — pilot your deck against an empty seat.</p>

        {loading ? (
          <p className="ng-note">Loading decks…</p>
        ) : decks.length === 0 ? (
          <p className="ng-note">No decks found. Build one in the Deck Constructor first.</p>
        ) : (
          <div className="ng-decks">
            {decks.map((d) => {
              const total = d.cards.reduce((s, c) => s + c.count, 0);
              const lc = d.leaderId ? cardMap.get(d.leaderId) : undefined;
              const col = lc ? cardColorHex(lc) : "#3a4a5e";
              return (
                <button
                  key={d.id}
                  className={`ng-deck${selected === d.id ? " on" : ""}`}
                  style={{ ["--lc" as string]: col }}
                  onClick={() => setSelected(d.id)}
                >
                  <span className="ng-deck-art">
                    {lc?.image && <img src={lc.image} alt="" draggable={false} loading="lazy" />}
                  </span>
                  <span className="ng-deck-main">
                    <span className="ng-deck-name">{d.name}</span>
                    <span className="ng-deck-sub">{d.leaderName} · {total} cards · {d.format || "Standard"}</span>
                  </span>
                  <span className="ng-deck-check">{selected === d.id ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="ng-actions">
          <button className="ng-btn ghost" onClick={onBack}>Back</button>
          <button
            className="ng-btn primary"
            disabled={!deck || starting}
            onClick={() => { if (deck) { setStarting(true); onStart(deck); } }}
          >
            {starting ? "Setting sail…" : "Start Game"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Zone viewer modal (deck search / trash browsing) ────────────────────────

export type ViewerZone = "deck" | "trash";

export function ZoneViewer({ zone, player, cardMap, onClose }: {
  zone: ViewerZone;
  player: PlayerState;
  cardMap: Map<string, Card>;
  onClose: () => void;
}) {
  const { moveCard, shuffleDeck } = useGameStore();
  const insts = (player.zones[zone] ?? [])
    .map((iid) => player.instances[iid])
    .filter(Boolean);

  const move = (iid: InstanceId, to: ZoneId, toIndex?: number) =>
    moveCard({ playerId: player.id, instanceId: iid, from: zone, to, toIndex });

  // Official rule: shuffle after searching the deck.
  const close = () => {
    if (zone === "deck") shuffleDeck(player.id);
    onClose();
  };

  // Esc closes (same path as overlay click, so the deck still gets shuffled)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, player.id]);

  return (
    <div className="gb-modal-overlay" onClick={close}>
      <div className="gb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gb-modal-h">
          <span className="gb-modal-title">{zone === "deck" ? "Deck Search" : "Trash"}</span>
          <span className="gb-modal-sub">{insts.length} card{insts.length !== 1 ? "s" : ""}{zone === "deck" ? " · top first" : ""}</span>
        </div>
        <div className="gb-viewer-grid">
          {insts.length === 0 && <span className="gb-slot-hint">Empty</span>}
          {insts.map((i) => {
            const card = cardMap.get(i.cardId);
            return (
              <div className="gb-viewer-item" key={i.instanceId}>
                <div className="gb-viewer-art">
                  {card?.image
                    ? <img src={card.image} alt={card.name} draggable={false} loading="lazy" />
                    : <span className="gb-viewer-fallback">{card?.name ?? i.cardId}</span>}
                </div>
                <div className="gb-viewer-name">{card?.name ?? i.cardId}</div>
                <div className="gb-viewer-actions">
                  <button className="gb-mini-btn" onClick={() => move(i.instanceId, "hand")}>Hand</button>
                  <button className="gb-mini-btn" onClick={() => move(i.instanceId, "playArea")}>Play</button>
                  <button className="gb-mini-btn" onClick={() => move(i.instanceId, "deck", 0)}>Top</button>
                  <button className="gb-mini-btn" onClick={() => move(i.instanceId, "deck")}>Bottom</button>
                  {zone !== "trash" && (
                    <button className="gb-mini-btn danger" onClick={() => move(i.instanceId, "trash")}>Trash</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="gb-modal-f">
          <button className="gb-btn primary" onClick={close}>
            {zone === "deck" ? "Close & Shuffle" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

export function CtxMenu({ ctx, player, cardMap, onOpenViewer, onClose }: {
  ctx: CtxState;
  player: PlayerState;
  cardMap: Map<string, Card>;
  onOpenViewer: (zone: ViewerZone) => void;
  onClose: () => void;
}) {
  const { restCard, flipCard, moveCard, attachDon, setMarker, declareAttack } = useGameStore();
  const inst = player.instances[ctx.instanceId];
  if (!inst) return null;

  const pid = player.id;
  const act = (fn: () => void) => { fn(); onClose(); };

  const isDonInCost = inst.cardId === "DON" && ctx.zone === "donActive";
  const onBoard = ctx.zone === "leader" || ctx.zone === "characterArea";

  // DON!! attach targets: Leader + every character on the board
  const attachTargets: { id: InstanceId; label: string }[] = [];
  if (isDonInCost && !inst.attachedTo) {
    const leaderId = player.zones.leader[0];
    if (leaderId) attachTargets.push({ id: leaderId, label: "Attach to Leader" });
    for (const cid of player.zones.characterArea) {
      const c = player.instances[cid];
      if (!c) continue;
      attachTargets.push({ id: cid, label: `Attach to ${cardMap.get(c.cardId)?.name ?? c.cardId}` });
    }
  }

  const menuStyle: React.CSSProperties = {
    top:  Math.min(ctx.y, window.innerHeight - 320),
    left: Math.min(ctx.x, window.innerWidth - 190),
  };

  return (
    <div className="gb-ctx" style={menuStyle}>
      {ctx.zone === "playArea" && (
        <>
          <button className="gb-ctx-item" onClick={() => act(() =>
            moveCard({ playerId: pid, instanceId: ctx.instanceId, from: ctx.zone, to: "trash" }))}>
            Resolve → Trash
          </button>
          <div className="gb-ctx-sep" />
        </>
      )}
      {attachTargets.length > 0 && (
        <>
          {attachTargets.map((t) => (
            <button key={t.id} className="gb-ctx-item" onClick={() => act(() =>
              attachDon(pid, ctx.instanceId, t.id))}>
              {t.label}
            </button>
          ))}
          <div className="gb-ctx-sep" />
        </>
      )}
      {onBoard && !inst.rested && (
        <button className="gb-ctx-item" onClick={() => act(() => declareAttack(pid, ctx.instanceId))}>
          ⚔ Attack
        </button>
      )}
      <button className="gb-ctx-item" onClick={() => act(() => restCard(pid, ctx.instanceId))}>
        {inst.rested ? "Stand (Active)" : "Rest"}
      </button>
      <button className="gb-ctx-item" onClick={() => act(() => flipCard(pid, ctx.instanceId))}>
        {ctx.zone === "deck"
          ? (inst.faceUp ? "Hide Top" : "Reveal Top")
          : (inst.faceUp ? "Flip Face-Down" : "Flip Face-Up")}
      </button>
      {onBoard && (
        <>
          <button className="gb-ctx-item" onClick={() => act(() => setMarker(pid, ctx.instanceId, 1000))}>
            Power +1000
          </button>
          <button className="gb-ctx-item" onClick={() => act(() => setMarker(pid, ctx.instanceId, -1000))}>
            Power −1000
          </button>
        </>
      )}
      <div className="gb-ctx-sep" />
      {ctx.zone === "deck" && (
        <button className="gb-ctx-item" onClick={() => act(() => onOpenViewer("deck"))}>
          Search Deck…
        </button>
      )}
      {ctx.zone === "trash" && (
        <button className="gb-ctx-item" onClick={() => act(() => onOpenViewer("trash"))}>
          View Trash…
        </button>
      )}
      {ctx.zone !== "hand" && (
        <button className="gb-ctx-item" onClick={() => act(() =>
          moveCard({ playerId: pid, instanceId: ctx.instanceId, from: ctx.zone, to: "hand" }))}>
          Move to Hand
        </button>
      )}
      {ctx.zone !== "playArea" && ctx.zone !== "donActive" && ctx.zone !== "donDeck" && (
        <button className="gb-ctx-item" onClick={() => act(() =>
          moveCard({ playerId: pid, instanceId: ctx.instanceId, from: ctx.zone, to: "playArea" }))}>
          Move to Play Area
        </button>
      )}
      {ctx.zone !== "trash" && (
        <button className="gb-ctx-item" onClick={() => act(() =>
          moveCard({ playerId: pid, instanceId: ctx.instanceId, from: ctx.zone, to: "trash" }))}>
          Send to Trash
        </button>
      )}
      {ctx.zone !== "deck" && (
        <>
          <button className="gb-ctx-item" onClick={() => act(() =>
            moveCard({ playerId: pid, instanceId: ctx.instanceId, from: ctx.zone, to: "deck", toIndex: 0 }))}>
            Deck Top
          </button>
          <button className="gb-ctx-item" onClick={() => act(() =>
            moveCard({ playerId: pid, instanceId: ctx.instanceId, from: ctx.zone, to: "deck" }))}>
            Deck Bottom
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main BoardPage ───────────────────────────────────────────────────────────

export function BoardPage() {
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
  const [preview, setPreview]     = useState<Card | null>(null);
  const [viewer, setViewer]       = useState<ViewerZone | null>(null);
  const [logsOpen, setLogsOpen]   = useState(false);
  // DON!! click-to-select flow: click DON!! to (de)select; while any are selected
  // the action bar offers Rest / Cancel, and clicking a Leader/Character gives them.
  const [selectedDon, setSelectedDon] = useState<Set<InstanceId>>(new Set());
  const toggleDon = useCallback((id: InstanceId) => {
    setSelectedDon((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearDon = useCallback(() => setSelectedDon(new Set()), []);
  const restSelectedDon = useCallback(() => {
    selectedDon.forEach((id) => restCard(playerId, id));
    setSelectedDon(new Set());
  }, [selectedDon, restCard, playerId]);
  const assignDonTo = useCallback((targetId: InstanceId) => {
    selectedDon.forEach((id) => attachDon(playerId, id, targetId));
    setSelectedDon(new Set());
  }, [selectedDon, attachDon, playerId]);
  // overview keeps showing the LAST hovered card (mouse-leave doesn't blank it)
  const hoverCard = useCallback((c: Card | null) => { if (c) setPreview(c); }, []);
  const [rollToast, setRollToast] = useState<string | null>(null);
  const rollTimer = useRef<number | null>(null);

  // Coin flip / die roll: the store decides + logs the result; we toast it.
  const handleRoll = (sides: number) => {
    rollDie(playerId, sides);
    const log = useGameStore.getState().state.actionLog;
    const last = log[log.length - 1];
    if (last?.type === "dieRoll") {
      setRollToast(last.sides === 2 ? `Coin — ${last.result === 1 ? "HEADS" : "TAILS"}` : `D${last.sides} — ${last.result}`);
      if (rollTimer.current) window.clearTimeout(rollTimer.current);
      rollTimer.current = window.setTimeout(() => setRollToast(null), 1800);
    }
  };

  useEffect(() => { loadCardsById().then(setCardMap).catch(() => {}); }, []);
  useEffect(() => { if (!gameActive) setShowNewGame(true); }, [gameActive]);

  // DuelingBook-style hover menu: quick actions shown above the card per zone.
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

  // Close context menu on outside click (clicks INSIDE the menu must land first)
  useEffect(() => {
    if (!ctx) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".gb-ctx")) return;
      setCtx(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [ctx]);

  // Instance → zone lookup
  const instanceToZone = useMemo<Map<InstanceId, ZoneId>>(() => {
    const map = new Map<InstanceId, ZoneId>();
    if (!player) return map;
    for (const z of ZONE_IDS) {
      for (const iid of player.zones[z] ?? []) map.set(iid, z);
    }
    return map;
  }, [player]);

  // Start a game
  const handleStart = useCallback(async (deck: Deck) => {
    if (!deck.leaderId) return;
    const cm = cardMap.size > 0 ? cardMap : await loadCardsById();
    if (cardMap.size === 0) setCardMap(cm);
    const leaderCard = cm.get(deck.leaderId);
    const leaderLife = leaderCard?.cost ?? 4;
    const input: SetupInput = {
      leaderId: deck.leaderId,
      leaderLife,
      main: deck.cards.map((c) => ({ cardId: c.id, count: c.count })),
    };
    setup(playerId, input);
    setShowNewGame(false);
  }, [cardMap, playerId, setup]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as InstanceId);
    setCtx(null);
    setPreview(null);
    setSelectedDon(new Set());
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || !player) return;
    const instanceId = active.id as InstanceId;
    const fromZone = instanceToZone.get(instanceId);
    const toZone   = over.id as ZoneId;
    if (!fromZone || fromZone === toZone) return;

    // Dropping a DON!! from the cost area onto Leader/Characters = give DON.
    // v1 simplification: zone-level drop targets only, so we attach to the
    // leader / the first character (precise targeting via context menu).
    const inst = player.instances[instanceId];
    if (inst?.cardId === "DON" && fromZone === "donActive" && (toZone === "leader" || toZone === "characterArea")) {
      const targetId = player.zones[toZone][0];
      if (targetId) attachDon(playerId, instanceId, targetId);
      return;
    }

    moveCard({ playerId, instanceId, from: fromZone, to: toZone });
  };

  const openCtx = useCallback((instanceId: InstanceId, x: number, y: number) => {
    if (!player) return;
    const zone = instanceToZone.get(instanceId);
    if (!zone) return;
    setCtx({ instanceId, zone, x, y });
  }, [player, instanceToZone]);

  // Board helpers
  const deckCount  = player?.zones.deck.length    ?? 0;
  const donLeft    = player?.zones.donDeck.length  ?? 0;
  const handInsts  = player
    ? player.zones.hand.map((id) => player.instances[id]).filter(Boolean)
    : [];

  const leaderInstId = player?.zones.leader[0];
  const leaderCard   = leaderInstId ? cardMap.get(player!.instances[leaderInstId]?.cardId || "") : undefined;
  const leaderColor  = leaderCard ? cardColorHex(leaderCard) : "#e3b24c";

  // Official refresh phase, then advance the turn (both fully in the actionLog)
  const handleNextTurn = () => {
    if (!player) return;
    refresh(playerId);
    nextTurn();
  };

  const lifeCount = player?.zones.life.length ?? 0;
  const handleTakeLife = () => {
    if (!player || lifeCount === 0) return;
    // Top life card = last in the array (rendered on top of the stack).
    const top = player.zones.life[lifeCount - 1];
    moveCard({ playerId, instanceId: top, from: "life", to: "hand" });
  };

  const handleDetachDon = useCallback(
    (donId: InstanceId) => attachDon(playerId, donId, null),
    [attachDon, playerId],
  );

  // Drag overlay active card
  const activeInst = activeId && player ? player.instances[activeId] : null;
  const activeCard = activeInst ? cardMap.get(activeInst.cardId) : undefined;

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!gameActive && !showNewGame) {
    return (
      <div className="sn gb-felt" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh" }}>
        <button className="ng-btn primary" onClick={() => setShowNewGame(true)}>New Game</button>
      </div>
    );
  }

  return (
    <>
      {showNewGame && (
        <NewGameScreen
          cardMap={cardMap}
          onStart={handleStart}
          onBack={() => (gameActive ? setShowNewGame(false) : setView("home"))}
        />
      )}

      {gameActive && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="gb-felt" style={{ ["--lc" as string]: leaderColor }}>

            {/* top bar */}
            <div className="gb-topbar">
              <button className="gb-top-btn" onClick={() => setView("home")}>← Exit</button>
              <div className="gb-turnpill">
                <span className="gb-turn-k">Turn</span>
                <span className="gb-turn-v">{state.turn}</span>
              </div>
              <div className="gb-top-right">
                <span className="gb-opp-name">Practice · empty seat</span>
              </div>
            </div>

            {/* 3-column table: card overview | mat | controls+log+chat */}
            <div className="gb-main3">
              {/* LEFT — card overview */}
              <aside className="gb-side gb-side-left">
                <CardOverview card={preview} />
              </aside>

              {/* CENTER — opponent hand + mat */}
              <section className="gb-centercol">
                <OppHand count={5} />
                <div className="gb-mat">
                  <OppHalf />
                  <div className="gb-divider">
                    <span className="gb-compass" />
                  </div>
                  <MyHalf player={player} cardMap={cardMap} onCtx={openCtx} onHover={hoverCard} onDetachDon={handleDetachDon} quickFor={quickFor} leaderColor={leaderColor} selectedDon={selectedDon} onToggleDon={toggleDon} onAssignDon={assignDonTo} />
                </div>
              </section>

              {/* RIGHT — controls + log + chat */}
              <aside className="gb-side gb-side-right">
                <div className="gb-panel gb-ctrlpanel">
                  <div className="gb-controls">
                    <button className="gb-btn" onClick={() => drawCard(playerId)} disabled={deckCount === 0}>
                      Draw <span className="gb-btn-n">{deckCount}</span>
                    </button>
                    <button className="gb-btn gold" onClick={() => drawDon(playerId)} disabled={donLeft === 0}>
                      DON!! <span className="gb-btn-n">{donLeft}</span>
                    </button>
                    <button className="gb-btn" onClick={() => shuffleDeck(playerId)}>Shuffle</button>
                    <button className="gb-btn" onClick={() => mulligan(playerId)}>Mulligan</button>
                    <button className="gb-btn" onClick={() => handleRoll(2)}>Coin Flip</button>
                    <button className="gb-btn" onClick={() => handleRoll(6)}>Roll D6</button>
                    <button className="gb-btn" onClick={handleTakeLife} disabled={lifeCount === 0}>
                      Take Life <span className="gb-btn-n">{lifeCount}</span>
                    </button>
                    <button className="gb-btn" onClick={() => setLogsOpen(true)}>Logs</button>
                    <button className="gb-btn danger" onClick={() => { resetGame(); setShowNewGame(true); }}>Reset</button>
                    <button className="gb-btn primary" onClick={handleNextTurn}>Next Turn</button>
                  </div>
                </div>
                <GameChat />
              </aside>
            </div>

            {/* my hand */}
            <MyHand insts={handInsts} cardMap={cardMap} onCtx={openCtx} onHover={hoverCard} quickFor={quickFor} />

            {/* coin/die result toast */}
            {rollToast && <div className="gb-rolltoast">{rollToast}</div>}

            {/* DON!! selection action bar */}
            {selectedDon.size > 0 && (
              <div className="gb-donbar">
                <span className="gb-donbar-n">{selectedDon.size} DON!! selected</span>
                <span className="gb-donbar-hint">Click a Leader or Character to give →</span>
                <button className="gb-donbar-btn" onClick={restSelectedDon}>Rest</button>
                <button className="gb-donbar-btn cancel" onClick={clearDon}>Cancel</button>
              </div>
            )}
          </div>

          {/* Drag ghost */}
          <DragOverlay>
            {activeInst && (
              <div className="gb-ghost">
                <CardArt inst={activeInst} card={activeCard} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Context menu — outside DndContext to avoid pointer conflicts */}
      {ctx && player && (
        <CtxMenu
          ctx={ctx}
          player={player}
          cardMap={cardMap}
          onOpenViewer={setViewer}
          onClose={() => setCtx(null)}
        />
      )}

      {/* Zone viewer — deck search / trash browsing */}
      {viewer && player && (
        <ZoneViewer zone={viewer} player={player} cardMap={cardMap} onClose={() => setViewer(null)} />
      )}

      {/* Action log popup */}
      {logsOpen && <LogsModal log={state.actionLog} onClose={() => setLogsOpen(false)} />}
    </>
  );
}
