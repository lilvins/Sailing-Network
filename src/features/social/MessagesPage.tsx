import { useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { api, type ChatMessage, type DirectoryUser, type ThreadSummary } from "../../lib/api";
import { usePresenceStore } from "../../lib/presenceStore";
import { Header, Dock, Ico } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { PresenceBadge } from "../profiles/PresenceBadge";
import { loadCardsById, type Card } from "../cards/cardsDb";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";
import { PixelScene } from "../pixel/PixelScene";

/* Real direct messages — every message is persisted server-side. Threads and the
   active conversation poll every few seconds so two browser tabs can chat. */

const POLL_MS = 4000;

function relTime(ms: number) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}

export function MessagesPage() {
  const openThreadWith = useUiStore((s) => s.openThreadWith);
  const openMessagesWith = useUiStore((s) => s.openMessagesWith);
  const presenceStore = usePresenceStore();

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [activeUsername, setActiveUsername] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // initial load: threads + directory (for avatars/colours of all captains)
  useEffect(() => {
    Promise.all([api.myThreads(), api.directory(), loadCardsById(), presenceStore.fetch()])
      .then(([t, d, c]) => {
        setThreads(t.threads);
        setDir(d.users);
        setCards(c);
        // if the page was opened via "Message X", select that thread right away
        if (openThreadWith) setActiveUsername(openThreadWith);
      })
      .catch(() => {});
    const presenceInterval = setInterval(() => presenceStore.fetch(), 30000);
    return () => clearInterval(presenceInterval);
  }, [openThreadWith, presenceStore]);

  // poll threads (so the inbox updates with new messages from others)
  useEffect(() => {
    const tick = () => api.myThreads().then(({ threads }) => setThreads(threads)).catch(() => {});
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // load + poll the active conversation
  useEffect(() => {
    if (!activeUsername) return;
    let alive = true;
    const tick = async () => {
      try {
        const { messages } = await api.threadWith(activeUsername);
        if (!alive) return;
        setMessages(messages);
        // mark-as-read happens server-side on every fetch, but also bump local unread
        setThreads((ts) => ts.map((t) => (t.peer.username === activeUsername ? { ...t, unread: 0 } : t)));
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        });
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [activeUsername]);

  // contacts shown on the left: anyone you have an existing thread with, plus
  // — when picked via a "Message" button — that captain even if no history yet.
  const imageOf = (u?: DirectoryUser) => (u?.favoriteLeader ? cards?.get(u.favoriteLeader)?.image || null : null);
  const contacts = useMemo(() => {
    const map = new Map<string, { username: string; displayName: string; color: string; image: string | null; preview: string; time: number; unread: number; }>();
    for (const t of threads) {
      const u = dir.find((d) => d.username === t.peer.username);
      map.set(t.peer.username, {
        username: t.peer.username,
        displayName: t.peer.displayName,
        color: u?.avatarColor || "#7a3030",
        image: imageOf(u),
        preview: (t.lastFromMe ? "You: " : "") + t.lastBody,
        time: t.lastAt,
        unread: t.unread,
      });
    }
    if (activeUsername && !map.has(activeUsername)) {
      const u = dir.find((d) => d.username === activeUsername);
      if (u) map.set(activeUsername, { username: u.username, displayName: u.displayName, color: u.avatarColor, image: imageOf(u), preview: "Say hi 👋", time: 0, unread: 0 });
    }
    return [...map.values()].sort((a, b) => b.time - a.time);
  }, [threads, dir, activeUsername, cards]);

  const active = contacts.find((c) => c.username === activeUsername) || null;

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeUsername || sending) return;
    setSending(true);
    // optimistic: append immediately
    const optimistic: ChatMessage = { id: "local-" + Math.random(), fromMe: true, body: text, createdAt: Date.now(), readAt: null };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    try {
      await api.sendThreadMessage(activeUsername, text);
      // refresh both panes so threads list updates and we get the server id
      const [{ messages }, { threads }] = await Promise.all([api.threadWith(activeUsername), api.myThreads()]);
      setMessages(messages);
      setThreads(threads);
    } catch (e) {
      // revert optimistic message on failure
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    }
  };

  const selectThread = (username: string) => {
    setActiveUsername(username);
    // clear any incoming-thread hint from the store after using it once
    openMessagesWith(null);
  };

  return (
    <div className="sn snp px">
      <PixelScene kind="night" />
      <Header title="Messages" sub="Talk to your crew" hero="/assets/bg/sec-messages.png" heroSlim />
      <div className="snp-body">
        <div className="snp-wrap">
          <div className="msg-layout" data-active={active ? "true" : "false"}>
            {/* threads */}
            <div className="msg-list">
              <div className="msg-list-scroll">
                {contacts.map((c) => {
                  const peer = dir.find((d) => d.username === c.username);
                  return (
                    <button key={c.username} className={"msg-conv" + (c.username === activeUsername ? " active" : "")} onClick={() => selectThread(c.username)}>
                      <LeaderAvatar name={c.displayName} color={c.color} image={c.image} size={46} />
                      <div className="msg-conv-main">
                        <div className="msg-conv-top">
                          <span className="msg-conv-name"><PresenceBadge userId={peer?.id || ""} /> {c.displayName}</span>
                          <span className="msg-conv-time">{c.time ? relTime(c.time) : ""}</span>
                        </div>
                        <div className="msg-conv-prev">{c.preview}</div>
                      </div>
                      {c.unread > 0 && <span className="msg-unread">{c.unread}</span>}
                    </button>
                  );
                })}
                {contacts.length === 0 && (
                  <div style={{ padding: 24, color: "var(--muted)", fontSize: 13 }}>
                    No conversations yet. Open a captain's profile and tap "Message".
                  </div>
                )}
              </div>
            </div>

            {/* active thread */}
            <div className="msg-thread">
              {active ? (
                <>
                  <div className="msg-thread-head">
                    <button className="msg-thread-back" onClick={() => setActiveUsername(null)} aria-label="Back to conversations">
                      <Ico n="back" size={16} />
                    </button>
                    <LeaderAvatar name={active.displayName} color={active.color} image={active.image} />
                    <div>
                      <div className="msg-thread-name"><PresenceBadge userId={dir.find((d) => d.username === active.username)?.id || ""} /> {active.displayName}</div>
                      <div className="msg-thread-status">@{active.username}</div>
                    </div>
                  </div>
                  <div className="msg-scroll" ref={scrollRef}>
                    {messages.length === 0 && (
                      <div className="snp-empty" style={{ margin: "auto" }}>
                        <span className="px-critter captain" aria-hidden />
                        Nothing in the logbook yet. Say ahoy.
                      </div>
                    )}
                    {messages.map((m) => (
                      <div key={m.id} className={"msg-bubble " + (m.fromMe ? "me" : "them")}>{m.body}</div>
                    ))}
                  </div>
                  <div className="msg-input-bar">
                    <input
                      className="msg-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && send()}
                      placeholder="Message…"
                      maxLength={1000}
                    />
                    <button className="msg-send" onClick={send} disabled={sending || !draft.trim()}>
                      <Ico n="send" size={15} /> Send
                    </button>
                  </div>
                </>
              ) : (
                <div className="msg-scroll" style={{ alignItems: "center", justifyContent: "center" }}>
                  <div className="snp-empty">
                    <span className="px-critter crabby" aria-hidden />
                    No letter open. Pick a captain on the left.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dock />
    </div>
  );
}
