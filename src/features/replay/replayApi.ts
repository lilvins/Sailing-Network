/** The browser's side of server/replays.mjs. */
import type { PID } from "../../autosim/engine/state";
import type { ReplayRecord } from "./record";

export interface ReplaySummary {
  id: string;
  createdAt: number;
  /** A friend game, a game against the AI, or two players at one screen. */
  source: "friend" | "ai" | "local";
  format: string;
  /** Seat A then seat B; `userId` = the account that played it (null: the AI, or nobody's own seat). */
  seats: [ReplaySeatSummary, ReplaySeatSummary];
  winner: PID | null;
  firstPlayer: PID;
  turns: number;
  plays: number;
}
export interface ReplaySeatSummary { pid: PID; name: string; leaderId: string; userId: string | null }
export interface SavedReplay extends ReplaySummary { record: ReplayRecord }

/** Sends a finished game in; the replay's id, or null when it could not be kept. */
export async function sendReplay(record: ReplayRecord): Promise<string | null> {
  try {
    const r = await fetch("/api/replays", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record }),
    });
    return r.ok ? ((await r.json()) as { id: string }).id : null;
  } catch {
    return null; // offline: the game is over all the same
  }
}

/** Throws with the reason when the replay cannot be opened. */
export async function fetchReplay(id: string): Promise<SavedReplay> {
  const r = await fetch(`/api/replays/${encodeURIComponent(id)}`, { credentials: "include" });
  const data = (await r.json().catch(() => ({}))) as { replay?: SavedReplay; error?: string };
  if (!r.ok || !data.replay) throw new Error(data.error ?? "This replay could not be opened");
  return data.replay;
}

export async function myReplays(): Promise<ReplaySummary[]> {
  const r = await fetch("/api/me/replays", { credentials: "include" });
  return r.ok ? ((await r.json()) as { replays: ReplaySummary[] }).replays : [];
}

/** The address that opens a replay (App.tsx reads `?replay=`). */
export const replayLink = (id: string): string => `${window.location.origin}/?replay=${id}`;
