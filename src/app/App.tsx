import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { useUiStore, type View } from "./uiStore";
import { useAuthStore } from "./authStore";
import { usePresenceStore } from "../lib/presenceStore";
import { LoginPage } from "../features/login/LoginPage";
import { HomePage } from "../features/home/HomePage";
import { MessagesLayer } from "../features/social/MessagesPopup";
import { hasSavedRoom } from "../features/board-auto/savedRoom";

/** A page that is its own piece of the site: its code is fetched the first time it opens.
 *  Login and Home come with the first load; the tables bring the rules engine and the cards' effects. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const DuelRoomPage = page(() => import("../features/duel-room/DuelRoomPage"), "DuelRoomPage");
const MyProfile = page(() => import("../features/profiles/ProfilePages"), "MyProfile");
const DuelRecords = page(() => import("../features/profiles/ProfilePages"), "DuelRecords");
const ProfileViewer = page(() => import("../features/profiles/ProfileViewer"), "ProfileViewer");
const Rankings = page(() => import("../features/profiles/Rankings"), "Rankings");
const StatisticsPage = page(() => import("../features/social/StatisticsPage"), "StatisticsPage");
const FriendsPage = page(() => import("../features/social/FriendsPage"), "FriendsPage");
const DirectoryPage = page(() => import("../features/social/DirectoryPage"), "DirectoryPage");
const GlobalChatPage = page(() => import("../features/social/GlobalChatPage"), "GlobalChatPage");
const MetaPage = page(() => import("../features/social/MetaPage"), "MetaPage");
const DeckBuilderPage = page(() => import("../features/deck-builder/DeckBuilderPage"), "DeckBuilderPage");
const MyDecksPage = page(() => import("../features/deck-builder/MyDecksPage"), "MyDecksPage");
const PopularDecklistsPage = page(() => import("../features/popular/PopularDecklistsPage"), "PopularDecklistsPage");
const AdminPage = page(() => import("../features/admin/AdminPage"), "AdminPage");
const CreditsPage = page(() => import("../features/credits/CreditsPage"), "CreditsPage");
const BoardPage = page(() => import("../features/board/BoardPage"), "BoardPage");
const BoardPage2 = page(() => import("../features/board/BoardPage2"), "BoardPage2");
const BoardAutoPage = page(() => import("../features/board-auto/BoardAutoPage"), "BoardAutoPage");
const BoardBotPage = page(() => import("../features/board-bot/BoardBotPage"), "BoardBotPage");
const ReplayPage = page(() => import("../features/replay/ReplayPage"), "ReplayPage");

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
  if (!user) return view === "replay" ? <Suspense fallback={<AppLoading />}><ReplayPage /></Suspense> : <LoginPage />;

  // authenticated: bounce off login, and keep non-admins out of the admin area
  let effectiveView = view;
  if (view === "login") effectiveView = "home";
  if (view === "admin" && user.role !== "admin") effectiveView = "home";
  return (
    <>
      <Suspense fallback={<AppLoading />}>
        <CurrentView view={effectiveView} />
      </Suspense>
      <MessagesLayer />
    </>
  );
}
