import { useEffect } from "react";
import { useUiStore, type View } from "./uiStore";
import { useAuthStore } from "./authStore";
import { usePresenceStore } from "../lib/presenceStore";
import { LoginPage } from "../features/login/LoginPage";
import { HomePage } from "../features/home/HomePage";
import { DuelRoomPage } from "../features/duel-room/DuelRoomPage";
import { MyProfile, DuelRecords } from "../features/profiles/ProfilePages";
import { ProfileViewer } from "../features/profiles/ProfileViewer";
import { Rankings } from "../features/profiles/Rankings";
import { StatisticsPage } from "../features/social/StatisticsPage";
import { MessagesLayer } from "../features/social/MessagesPopup";
import { FriendsPage } from "../features/social/FriendsPage";
import { DirectoryPage } from "../features/social/DirectoryPage";
import { GlobalChatPage } from "../features/social/GlobalChatPage";
import { MetaPage } from "../features/social/MetaPage";
import { DeckBuilderPage } from "../features/deck-builder/DeckBuilderPage";
import { MyDecksPage } from "../features/deck-builder/MyDecksPage";
import { PopularDecklistsPage } from "../features/popular/PopularDecklistsPage";
import { AdminPage } from "../features/admin/AdminPage";
import { CreditsPage } from "../features/credits/CreditsPage";
import { BoardPage } from "../features/board/BoardPage";
import { BoardPage2 } from "../features/board/BoardPage2";
import { BoardAutoPage } from "../features/board-auto/BoardAutoPage";
import { hasSavedRoom } from "../features/board-auto/room";
import { BoardBotPage } from "../features/board-bot/BoardBotPage";
import { ReplayPage } from "../features/replay/ReplayPage";

/**
 * App shell. Each ported page is full-screen (its own chrome), so there is no
 * shared nav bar — navigation happens via the in-page controls + uiStore.
 * Auth gates everything: until /auth/me resolves we show a loader; logged-out
 * users only ever see the LoginPage; the admin area is admin-only.
 * The one exception is a replay's link (`/?replay=<id>`): whoever has it
 * watches, account or not.
 */

const LABELS: Partial<Record<View, string>> = {
  "duel-room": "Duel Room",
  "deck-constructor": "Deck Constructor",
  directory: "Player Directory",
  "profile-viewer": "Profile Viewer",
  "edit-profile": "Edit Profile",
  rankings: "Rankings",
  records: "Duel Records",
  statistics: "My Statistics",
};

function ComingSoon({ view }: { view: View }) {
  const setView = useUiStore((s) => s.setView);
  return (
    <div className="fixed inset-0 grid place-items-center px-6 text-center bg-[var(--bg)]">
      <div className="flex flex-col items-center gap-4">
        <span className="text-[0.7rem] uppercase tracking-[0.22em] text-[var(--text-muted)]">
          Sailing Network
        </span>
        <h1 className="text-3xl font-bold text-[var(--text)]">{LABELS[view] ?? view}</h1>
        <p className="max-w-sm text-[var(--text-muted)]">
          Pagina in arrivo nel porting del design — la integro a breve.
        </p>
        <button className="btn btn-primary" onClick={() => setView("home")}>
          ← Back to Home
        </button>
      </div>
    </div>
  );
}

function AppLoading() {
  return (
    <div className="sn" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "3px solid var(--edge2)",
            borderTopColor: "var(--acc, #e23b32)",
            animation: "db-spin .8s linear infinite",
          }}
        />
        <span style={{ color: "var(--muted)", font: "500 13px var(--font)" }}>Sailing Network</span>
      </div>
    </div>
  );
}

function CurrentView({ view }: { view: View }) {
  switch (view) {
    case "login":
      return <LoginPage />;
    case "home":
      return <HomePage />;
    case "duel-room":
      return <DuelRoomPage />;
    case "directory":
      return <DirectoryPage />;
    case "profile-viewer":
      return <ProfileViewer />;
    case "edit-profile":
      return <MyProfile />;
    case "rankings":
      return <Rankings />;
    case "records":
      return <DuelRecords />;
    case "statistics":
      return <StatisticsPage />;
    case "friends":
      return <FriendsPage />;
    case "global-chat":
      return <GlobalChatPage />;
    case "meta":
      return <MetaPage />;
    case "deck-constructor":
      return <DeckBuilderPage />;
    case "my-decks":
      return <MyDecksPage />;
    case "popular-decklists":
      return <PopularDecklistsPage />;
    case "admin":
      return <AdminPage />;
    case "credits":
      return <CreditsPage />;
    case "board":
      return <BoardPage />;
    case "board2":
      return <BoardPage2 />;
    case "board-auto":
      return <BoardAutoPage />;
    case "board-bot":
      return <BoardBotPage />;
    case "replay":
      return <ReplayPage />;
    default:
      return <ComingSoon view={view} />;
  }
}

export function App() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const openReplay = useUiStore((s) => s.openReplay);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const init = useAuthStore((s) => s.init);
  const presenceUpdate = usePresenceStore((s) => s.update);

  // restore session on first load
  useEffect(() => {
    void init();
  }, [init]);

  // set presence to "online" when logged in, poll every 30s, go "offline" on unmount/logout
  useEffect(() => {
    if (status !== "ready" || !user) return;
    void presenceUpdate("online");
    const interval = setInterval(() => presenceUpdate("online"), 30000);
    return () => {
      clearInterval(interval);
      void presenceUpdate("offline");
    };
  }, [status, user, presenceUpdate]);

  // keep navigation in sync with auth once it resolves
  useEffect(() => {
    if (status !== "ready") return;
    if (!user && view !== "login" && view !== "replay") setView("login");
    else if (user && view === "login") setView("home");
  }, [status, user, view, setView]);

  // a friend game left by a reload leads straight back to the table
  const signedIn = status === "ready" && !!user;
  useEffect(() => {
    if (status !== "ready") return;
    const link = new URLSearchParams(window.location.search);
    if (signedIn && hasSavedRoom()) setView("board-auto");
    else if (link.get("replay")) openReplay(link.get("replay")!); // a replay's link: no account needed
    else if (signedIn && link.has("duel")) setView("duel-room"); // an invitation link
  }, [status, signedIn, setView, openReplay]);

  if (status === "loading") return <AppLoading />;

  // a visitor: the replay they have the link of, or the landing page
  if (!user) return view === "replay" ? <ReplayPage /> : <LoginPage />;

  // authenticated: bounce off login, and keep non-admins out of the admin area
  let effectiveView = view;
  if (view === "login") effectiveView = "home";
  if (view === "admin" && user.role !== "admin") effectiveView = "home";
  return (
    <>
      <CurrentView view={effectiveView} />
      <MessagesLayer />
    </>
  );
}
