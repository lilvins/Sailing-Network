/// <reference lib="webworker" />
// The optcg-ai bot runs here, off the UI thread: it receives the game state and
// the seat to play, and answers with one Action. The bundle (cards with
// effects, playbooks) and the learned parameters are fetched once.

import { createBot, type BotLevel, type EngineBundle, type GameState, type LearnedParams, type Seat } from "../../optcg/bot";

interface Request {
  id: number;
  state: GameState;
  seat: Seat;
  level: BotLevel;
  seed: number;
}

let data: Promise<{ bundle: EngineBundle; learned: LearnedParams | null }> | null = null;

function load() {
  data ??= (async () => {
    const bundle = (await (await fetch("/data/optcg/bundle.json")).json()) as EngineBundle;
    let learned: LearnedParams | null = null;
    try {
      const r = await fetch("/data/optcg/learned.json", { cache: "no-store" });
      if (r.ok) learned = (await r.json()) as LearnedParams;
    } catch {
      learned = null;
    }
    return { bundle, learned };
  })();
  return data;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, state, seat, level, seed } = e.data;
  try {
    const { bundle, learned } = await load();
    const action = createBot(bundle, level, seed, learned).decide(state, seat);
    (self as unknown as Worker).postMessage({ id, action });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
