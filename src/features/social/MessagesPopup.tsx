import { useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "../../app/uiStore";
import { useAuthStore } from "../../app/authStore";
import { api, type ChatMessage, type DirectoryUser } from "../../lib/api";
import { usePresenceStore } from "../../lib/presenceStore";
import { Ico } from "../profiles/ProfilePages";
import { LeaderAvatar } from "../cards/LeaderAvatar";
import { PresenceBadge } from "../profiles/PresenceBadge";
import { loadCardsById, type Card } from "../cards/cardsDb";
import { useInboxStore } from "./inboxStore";
import "../home/home.css";
import "../profiles/profiles.css";
import "./social.css";
import "./messagesPopup.css";

/* Real direct messages in a window over whatever page is open, so a captain can
   talk mid-game. Every message is persisted server-side; the open conversation
   polls every few seconds, the inbox polls in inboxStore. */

const POLL_MS = 4000;
const NOTICE_MS = 6000;

function relTime(ms: number) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}

/** Window plus notice, for the logged-in captain, on every page. */
export function MessagesLayer() {
  const user = useAuthStore((s) => s.user);
  const open = useUiStore((s) => s.messagesOpen);
  const start = useInboxStore((s) => s.start);
  const stop = useInboxStore((s) => s.stop);

  useEffect(() => {
    if (!user) return;
    start();
    return stop;
  }, [user, start, stop]);

  if (!user) return null;
  return (
    <>
      {open && <MessagesPopup />}
      <MessageNotice />
    </>
  );
}

function MessageNotice() {
  const notice = useInboxStore((s) => s.notice);
  const dismiss = useInboxStore((s) => s.dismissNotice);
  const openMessagesWith = useUiStore((s) => s.openMessagesWith);
  const rotated = useUiStore((s) => s.tableRotated);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(dismiss, NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <button
      key={notice.id}
      className={`msgp-notice${rotated ? " rot" : ""}`}
      data-message-notice
      onClick={() => { openMessagesWith(notice.username); dismiss(); }}
    >
      <Ico n="chat" size={16} />
      <span className="msgp-notice-main">
        <b>{notice.displayName}</b>
        <span>{notice.body}</span>
      </span>
    </button>
  );
}

function MessagesPopup() {
  const openThreadWith = useUiStore((s) => s.openThreadWith);
  const setMessagesOpen = useUiStore((s) => s.setMessagesOpen);
  const rotated = useUiStore((s) => s.tableRotated);
  const threads = useInboxStore((s) => s.threads);
  const refreshInbox = useInboxStore((s) => s.refresh);
  const setViewing = useInboxStore((s) => s.setViewing);
  const presenceStore = usePresenceStore();

  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [cards, setCards] = useState<Map<string, Card> | null>(null);
  const [activeUsername, setActiveUsername] = useState<string | null>(openThreadWith);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Where the window was dragged to (null = its corner). */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<{ dx: number; dy: number } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // directory + card art, for the avatars and colours of all captains
  useEffect(() => {
    Promise.all([api.directory(), loadCardsById(), presenceStore.fetch()])
      .then(([d, c]) => {
        setDir(d.users);
        setCards(c);
      })
      .catch(() => {});
    const presenceInterval = setInterval(() => presenceStore.fetch(), 30000);
    return () => clearInterval(presenceInterval);
  }, [presenceStore]);

  // a "Message X" button or a notice picks the thread, also with the window open
  useEffect(() => {
    if (openThreadWith) setActiveUsername(openThreadWith);
  }, [openThreadWith]);

  useEffect(() => {
    setViewing(activeUsername);
    return () => setViewing(null);
  }, [activeUsername, setViewing]);

  const scrollToEnd = () => requestAnimationFrame(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  });

  // load + poll the active conversation (fetching it marks it read server-side)
  useEffect(() => {
    if (!activeUsername) return;
    let alive = true;
    setMessages([]);
    const tick = async () => {
      try {
        const { messages } = await api.threadWith(activeUsername);
        if (!alive) return;
        setMessages(messages);
        scrollToEnd();
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [activeUsername]);

  // contacts: anyone you have an existing thread with, plus — when picked via a
  // "Message" button — that captain even if no history yet.
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
        unread: t.peer.username === activeUsername ? 0 : t.unread,
      });
    }
    if (activeUsername && !map.has(activeUsername)) {
      const u = dir.find((d) => d.username === activeUsername);
      if (u) map.set(activeUsername, { username: u.username, displayName: u.displayName, color: u.avatarColor, image: imageOf(u), preview: "Say hi!", time: 0, unread: 0 });
    }
    return [...map.values()].sort((a, b) => b.time - a.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // refresh both panes so the list updates and we get the server id
      const [{ messages }] = await Promise.all([api.threadWith(activeUsername), refreshInbox()]);
      setMessages(messages);
    } catch {
      // revert optimistic message on failure
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
      scrollToEnd();
    }
  };

  const closeThread = () => {
    setActiveUsername(null);
    useUiStore.setState({ openThreadWith: null });
  };

  const onHeadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = windowRef.current?.getBoundingClientRect();
    if (rotated || !box || (e.target as HTMLElement).closest("button")) return;
    dragFrom.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeadMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = windowRef.current?.getBoundingClientRect();
    if (!dragFrom.current || !box) return;
    // always grabbable: the title bar never leaves the screen
    setPos({
      x: Math.min(Math.max(0, e.clientX - dragFrom.current.dx), window.innerWidth - box.width),
      y: Math.min(Math.max(0, e.clientY - dragFrom.current.dy), window.innerHeight - 48),
    });
  };

  return (
    <div
      ref={windowRef}
      className={`sn snp px msgp${rotated ? " rot" : ""}`}
      data-messages-popup
      style={pos && !rotated ? { left: pos.x, top: pos.y, bottom: "auto", right: "auto" } : undefined}
    >
      <div className="msgp-head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={() => { dragFrom.current = null; }}>
        <Ico n="chat" size={16} />
        <b>Messages</b>
        <button className="msgp-close" title="Close" aria-label="Close messages" onClick={() => setMessagesOpen(false)}>×</button>
      </div>
      <div className="msg-layout" data-active={active ? "true" : "false"}>
        <div className="msg-list">
          <div className="msg-list-scroll">
            {contacts.map((c) => {
              const peer = dir.find((d) => d.username === c.username);
              return (
                <button key={c.username} className="msg-conv" onClick={() => setActiveUsername(c.username)}>
                  <LeaderAvatar name={c.displayName} color={c.color} image={c.image} size={40} />
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

        {active && (
          <div className="msg-thread">
            <div className="msg-thread-head">
              <button className="msg-thread-back" onClick={closeThread} aria-label="Back to conversations">
                <Ico n="back" size={16} />
              </button>
              <LeaderAvatar name={active.displayName} color={active.color} image={active.image} size={32} />
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
          </div>
        )}
      </div>
    </div>
  );
}
