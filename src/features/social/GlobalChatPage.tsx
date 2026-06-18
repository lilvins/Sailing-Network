import { useEffect, useRef, useState } from "react";
import { api, type GlobalMessage } from "../../lib/api";
import { Header, Dock, Ico } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { loadCardsById, type Card } from "../cards/cardsDb";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";

/* Global chat — one shared room, every message persisted server-side, polled. */

const POLL_MS = 4000;
function relTime(ms: number) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}

export function GlobalChatPage() {
  const [messages, setMessages] = useState<GlobalMessage[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  useEffect(() => {
    loadCardsById().then(setCards).catch(() => {});
    const tick = async () => {
      try {
        const { messages } = await api.chat();
        setMessages(messages);
        if (atBottomRef.current) scrollToBottom();
      } catch {
        /* ignore */
      }
    };
    void tick().then(scrollToBottom);
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      await api.sendChat(body);
      const { messages } = await api.chat();
      setMessages(messages);
      atBottomRef.current = true;
      scrollToBottom();
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  };

  const imgOf = (id: string | null) => (id ? cards?.get(id)?.image || null : null);

  return (
    <div className="sn snp">
      <Header title="Global Chat" sub="One room · all captains" />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="gc-room">
            <div className="gc-scroll" ref={scrollRef} onScroll={onScroll}>
              {messages.length === 0 && <div className="gc-empty">No messages yet — say something to the crew.</div>}
              {messages.map((m) => (
                <div className={"gc-line" + (m.fromMe ? " me" : "")} key={m.id}>
                  <LeaderAvatar name={m.displayName} color={m.avatarColor} image={imgOf(m.favoriteLeader)} size={34} />
                  <div className="gc-body">
                    <div className="gc-meta">
                      <span className="gc-name">{m.displayName}</span>
                      <span className="gc-handle">@{m.username}</span>
                      <span className="gc-time">{relTime(m.createdAt)}</span>
                    </div>
                    <div className="gc-text">{m.body}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="msg-input-bar">
              <input
                className="msg-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message the crew…"
                maxLength={500}
              />
              <button className="msg-send" onClick={send} disabled={sending || !draft.trim()}>
                <Ico n="send" size={15} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}
