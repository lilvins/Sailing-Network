/**
 * A finished game watched again, at its own link (`/?replay=<id>`).
 *
 * The replay plays on the Play Auto table itself: this page fetches the record,
 * puts it in the table's store (autoStore `openReplay`) and shows the table,
 * which draws its replay controls. Leaving the page takes the replay off the
 * table again.
 */
import { useEffect, useState } from "react";
import { useAuthStore } from "../../app/authStore";
import { useUiStore } from "../../app/uiStore";
import { BoardAutoPage } from "../board-auto/BoardAutoPage";
import { useAutoStore } from "../board-auto/autoStore";
import { recordProblem } from "./record";
import { fetchReplay } from "./replayApi";

export function ReplayPage() {
  const id = useUiStore((s) => s.replayId);
  const goBack = useUiStore((s) => s.goBack);
  const userId = useAuthStore((s) => s.user?.id);
  const catalogReady = useAutoStore((s) => s.catalogReady);
  const catalogError = useAutoStore((s) => s.catalogError);
  const onTable = useAutoStore((s) => s.replay?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useAutoStore.getState().init();
  }, []);

  useEffect(() => {
    if (!id || !catalogReady) return;
    let alive = true;
    setError(null);
    fetchReplay(id)
      .then((saved) => {
        if (!alive) return;
        const problem = recordProblem(saved.record);
        if (problem) { setError(problem); return; }
        // a player watches from their own side; anyone else from seat A's
        const mine = saved.seats.filter((s) => s.userId === userId);
        useAutoStore.getState().openReplay(saved.id, saved.record, mine.length === 1 ? mine[0].pid : saved.record.seats[0].pid);
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "This replay could not be opened"); });
    return () => { alive = false; };
  }, [id, catalogReady, userId]);

  // while the replay is open the address bar holds its link, ready to be copied
  useEffect(() => {
    if (!id) return;
    window.history.replaceState(null, "", `/?replay=${id}`);
    return () => {
      window.history.replaceState(null, "", window.location.pathname);
      useAutoStore.getState().closeReplay();
    };
  }, [id]);

  const problem = !id ? "No replay to show." : catalogError ?? error;
  if (problem) {
    return (
      <div className="ba-root ba-center-screen">
        <div className="ba-panel ba-note" data-replay-error>
          <b>Replay unavailable</b>
          <p>{problem}</p>
          <button className="ba-btn" data-act="replay-back" onClick={goBack}>← Back</button>
        </div>
      </div>
    );
  }
  if (onTable !== id) {
    return (
      <div className="ba-root ba-center-screen">
        <span className="ba-loading">Loading the replay…</span>
      </div>
    );
  }
  return <BoardAutoPage />;
}
