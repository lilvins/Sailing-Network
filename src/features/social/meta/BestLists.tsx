/* Best lists: pick a leader, see its decklists with more than N ladder games,
   best win rate first. Each list shows its record, the 95% range, the cards
   (as art or as text) and copies to the clipboard in the "4xOP01-001" format
   the deck importers read. */

import { useEffect, useState } from "react";
import type { BestList, MetaGridReport } from "../../../lib/api";
import type { Card } from "../../cards/cardsDb";
import { cardColorHex } from "../../cards/cardsDb";
import { LeaderAvatar } from "../../cards/LeaderAvatar";
import { WinRateBar } from "../../stats/StatBits";
import { showPct } from "../../stats/format";

/** "1xLEADER" then "4xOP01-001" lines: the import format of the sims and our Deck Constructor. */
export function listToText(leaderId: string, cards: BestList["cards"]): string {
  return [`1x${leaderId}`, ...cards.map((c) => `${c.count}x${c.id}`)].join("\n");
}

function sortCards(cards: BestList["cards"], card: (id: string) => Card | null) {
  const cat = (id: string) => ({ Character: 0, Event: 1, Stage: 2 } as Record<string, number>)[card(id)?.category || ""] ?? 3;
  return [...cards].sort((a, b) => cat(a.id) - cat(b.id) || (card(a.id)?.cost ?? 99) - (card(b.id)?.cost ?? 99) || a.id.localeCompare(b.id));
}

function ListCard({ rank, list, leaderId, card }: { rank: number; list: BestList; leaderId: string; card: (id: string) => Card | null }) {
  const [view, setView] = useState<"cards" | "text">("cards");
  const [copied, setCopied] = useState(false);
  const cards = sortCards(list.cards, card);
  const total = list.cards.reduce((a, c) => a + c.count, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(listToText(leaderId, list.cards));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked: the text view is there to copy by hand */
      setView("text");
    }
  };

  return (
    <article className="px-plank mt-list">
      <div className="mt-list-top">
        <span className="mt-rank">{rank}</span>
        <div className="mt-list-name">
          <b title={list.name}>{list.name}</b>
          <small>{list.wins}W – {list.losses}L · {list.players} player{list.players === 1 ? "" : "s"} · {total} cards</small>
        </div>
        <div className="mt-num">
          <span>Win rate</span>
          <b className={(list.winRate ?? 0) >= 50 ? "good" : "bad"}>{showPct(list.winRate)}</b>
        </div>
        <div className="mt-num games">
          <span>Games</span>
          <b>{list.games}</b>
        </div>
        <div className="mt-list-actions">
          <div className="px-tabs mt-tabs" role="tablist" aria-label="Show as">
            <button role="tab" aria-selected={view === "cards"} className={"px-tab" + (view === "cards" ? " on" : "")} onClick={() => setView("cards")}>Cards</button>
            <button role="tab" aria-selected={view === "text"} className={"px-tab" + (view === "text" ? " on" : "")} onClick={() => setView("text")}>List</button>
          </div>
          <button className="px-btn px-btn--red" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
        </div>
      </div>
      {list.ci && (
        <div className="mt-list-ci">
          <span>95% range {showPct(list.ci[0])}–{showPct(list.ci[1])}</span>
          <WinRateBar rate={list.winRate} ci={list.ci} />
        </div>
      )}
      {view === "cards" ? (
        <div className="mt-cards">
          {cards.map((c) => {
            const k = card(c.id);
            return (
              <div className="mt-card" key={c.id} title={`${c.count}× ${k?.name || c.id} (${c.id})`}>
                {k?.image
                  ? <img src={k.image} alt={k.name} loading="lazy" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  : <span className="mt-cname">{c.id}</span>}
                <span className="mt-qty">{c.count}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-textlist">
          {cards.map((c) => (
            <div key={c.id}><span className="q">{c.count}×</span><span>{card(c.id)?.name || c.id}</span><span className="id">{c.id}</span></div>
          ))}
        </div>
      )}
    </article>
  );
}

export function BestLists({
  bestLists,
  moreThan,
  card,
  labelOf,
}: {
  bestLists: MetaGridReport["bestLists"];
  moreThan: number;
  card: (id: string) => Card | null;
  labelOf: (id: string) => string;
}) {
  const [leaderId, setLeaderId] = useState<string>("");
  useEffect(() => {
    if (!bestLists.some((b) => b.leaderId === leaderId)) setLeaderId(bestLists[0]?.leaderId || "");
  }, [bestLists, leaderId]);

  if (bestLists.length === 0) {
    return <div className="mt-empty">No list has more than {moreThan} games under these filters.</div>;
  }
  const sel = bestLists.find((b) => b.leaderId === leaderId) || bestLists[0];
  const color = (id: string) => { const c = card(id); return c ? cardColorHex(c) : "#3a2b25"; };

  return (
    <div className="mt-best">
      <nav className="px-plank mt-leaders" aria-label="Leaders">
        {bestLists.map((b) => (
          <button key={b.leaderId} className={"px-plank mt-leader" + (b.leaderId === sel.leaderId ? " on" : "")} aria-pressed={b.leaderId === sel.leaderId} onClick={() => setLeaderId(b.leaderId)}>
            <LeaderAvatar name={labelOf(b.leaderId)} color={color(b.leaderId)} image={card(b.leaderId)?.image} size={36} />
            <span style={{ minWidth: 0 }}>
              <b>{labelOf(b.leaderId)}</b>
              <small>{showPct(b.winRate)} · {b.games.toLocaleString()} games</small>
            </span>
            <span className="mt-count" title={`${b.lists.length} list${b.lists.length === 1 ? "" : "s"} with more than ${moreThan} games`}>{b.lists.length}</span>
          </button>
        ))}
      </nav>

      <div className="mt-lists">
        <div className="px-plank mt-lhead">
          <LeaderAvatar name={labelOf(sel.leaderId)} color={color(sel.leaderId)} image={card(sel.leaderId)?.image} size={44} />
          <h3>{labelOf(sel.leaderId)}</h3>
          <span className="px-badge">{sel.leaderId}</span>
          <div className="mt-stat"><span>Win rate</span><b>{showPct(sel.winRate)}</b></div>
          <div className="mt-stat"><span>Games</span><b>{sel.games.toLocaleString()}</b></div>
        </div>
        {sel.lists.map((l, i) => (
          <ListCard key={l.key} rank={i + 1} list={l} leaderId={sel.leaderId} card={card} />
        ))}
      </div>
    </div>
  );
}
