import { useEffect, useMemo, useState } from "react";
import { Header, Dock, Ico } from "../profiles/ProfilePages";
import "../home/home.css";
import "../profiles/profiles.css";
import "./popular.css";

/* Popular Decklists — real data scraped from egmanevents into
   public/data/popular.json (run `npm run scrape` to refresh). Click a list to
   open a popup with the full decklist (real card art) + Copy / Export.
   Falls back to an empty state if the JSON is missing. */

interface Card {
  id: string;
  count: number;
}
interface Deck {
  leaderId: string;
  leaderName: string;
  cards: Card[];
}
interface Regional {
  slug: string;
  name: string;
  date: string | null;
  players: number | null;
  decks: Deck[];
}
interface PopularData {
  artBase: string;
  regionals: Regional[];
}

const cleanName = (n: string) =>
  n
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/\s*One Piece Card Game\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();

const deckSize = (d: Deck) => 1 + d.cards.reduce((s, c) => s + c.count, 0);

function listText(d: Deck): string {
  return `Leader: ${d.leaderName} (${d.leaderId})\n` + d.cards.map((c) => `${c.count}x ${c.id}`).join("\n");
}

export function PopularDecklistsPage() {
  const [data, setData] = useState<PopularData | null>(null);
  const [failed, setFailed] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  const [open, setOpen] = useState<{ deck: Deck; rank: number; regional: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/data/popular.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PopularData) => setData(d))
      .catch(() => setFailed(true));
  }, []);

  const art = data?.artBase ?? "";
  const regional = data?.regionals[selIdx] ?? null;
  const imgUrl = useMemo(() => (id: string) => `${art}${id}.webp`, [art]);

  const copyList = (d: Deck) => {
    navigator.clipboard?.writeText(listText(d));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const exportList = (d: Deck) => {
    const blob = new Blob([listText(d)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.leaderName.replace(/\W+/g, "-")}-decklist.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!data) {
    return (
      <div className="sn snp">
        <Header title="Popular Decklists" sub="Top lists from recent regionals" />
        <div className="snp-body">
          <div className="snp-wrap">
            <div style={{ padding: "60px", textAlign: "center", color: "var(--muted)" }}>
              {failed ? "Tournament data unavailable — run `npm run scrape` to fetch it." : "Loading regionals…"}
            </div>
          </div>
        </div>
        <Dock />
      </div>
    );
  }

  return (
    <div className="sn snp">
      <Header title="Popular Decklists" sub="Top lists from recent regionals · egmanevents" />
      <div className="snp-body">
        <div className="snp-wrap pd-layout">
          {/* regionals */}
          <div className="so-card pd-regionals">
            <div className="so-card-h">Regionals</div>
            <div className="pd-reg-scroll">
              {data.regionals.map((r, i) => (
                <button key={r.slug} className={"pd-region" + (i === selIdx ? " on" : "")} onClick={() => setSelIdx(i)}>
                  <span className="pd-region-flag">
                    <Ico n="play" size={18} />
                  </span>
                  <span className="pd-region-main">
                    <span className="pd-region-name">{cleanName(r.name)}</span>
                    <span className="pd-region-sub">
                      {[r.date, r.players ? `${r.players} players` : null, `${r.decks.length} lists`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* decklists for the selected regional */}
          <div className="so-card pd-detail" key={selIdx}>
            <div className="pd-detail-head">
              <div>
                <div className="pd-detail-title">{regional ? cleanName(regional.name) : ""}</div>
                <div className="pd-detail-sub">
                  {regional ? [regional.date, regional.players ? `${regional.players} players` : null].filter(Boolean).join(" · ") : ""}
                </div>
              </div>
            </div>
            <div className="pd-lists">
              {regional?.decks.map((d, i) => (
                <div className="pd-list" key={i} onClick={() => setOpen({ deck: d, rank: i + 1, regional: cleanName(regional.name) })}>
                  <span className="pd-place">#{i + 1}</span>
                  <span className="pd-leader">
                    <img src={imgUrl(d.leaderId)} alt={d.leaderName} loading="lazy" />
                  </span>
                  <div className="pd-list-main">
                    <div className="pd-list-name">{d.leaderName}</div>
                    <div className="pd-list-player">{deckSize(d)} cards · {d.leaderId}</div>
                  </div>
                  <span className="pd-open-hint">
                    <Ico n="play" size={16} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Dock />

      {/* full-decklist popup with real card art */}
      {open && (
        <div className="pd-modal-overlay" onClick={() => setOpen(null)}>
          <div className="pd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pd-modal-head">
              <span className="pd-modal-leader">
                <img src={imgUrl(open.deck.leaderId)} alt={open.deck.leaderName} />
              </span>
              <div>
                <div className="pd-modal-title">{open.deck.leaderName}</div>
                <div className="pd-modal-meta">
                  #{open.rank} · {deckSize(open.deck)} cards · {open.regional}
                </div>
              </div>
              <button className="pd-modal-close" onClick={() => setOpen(null)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="pd-modal-body">
              <div className="pd-mgroup leader">
                <img className="pd-mcard" src={imgUrl(open.deck.leaderId)} alt={open.deck.leaderName} loading="lazy" />
              </div>
              {open.deck.cards.map((c, gi) => (
                <div className="pd-mgroup" key={gi}>
                  {Array.from({ length: c.count }, (_, ci) => (
                    <img key={ci} className="pd-mcard" src={imgUrl(c.id)} alt={c.id} loading="lazy" />
                  ))}
                </div>
              ))}
            </div>

            <div className="pd-modal-foot">
              <button className={"pd-btn" + (copied ? " done" : "")} onClick={() => copyList(open.deck)}>
                <Ico n={copied ? "check" : "save"} size={15} />
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="pd-btn primary" onClick={() => exportList(open.deck)}>
                <Ico n="play" size={15} /> Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
