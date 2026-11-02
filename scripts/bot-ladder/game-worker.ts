// game-worker.ts — plays one full AUTOSIM game between two Pro agents, in a worker
// thread so a long game never blocks the bots' HTTP traffic. Bundled by run.mjs.
// @ts-expect-error — the app tsconfig carries no Node type definitions
import { parentPort } from "node:worker_threads";
import cardsJson from "../../public/data/cards.json";
import type { Card } from "../../src/features/cards/cardsDb";
import { makeCardDb } from "../../src/features/board-auto/compile";
import { createGame } from "../../src/autosim/engine/engine";
import { actorOf, agentStep } from "../../src/autosim/ai/agent";
import { createProAgent } from "../../src/autosim/ai/pro";

const db = makeCardDb(new Map((cardsJson as Card[]).map((c) => [c.id, c])));

type Side = { leader: string; cards: { id: string; count: number }[]; skill: { candidates: number; rollouts: number } };
type Job = { id: number; seed: string; first: "p1" | "p2"; p1: Side; p2: Side; maxSteps: number };

const expand = (s: Side) => s.cards.flatMap((c) => Array<string>(c.count).fill(c.id));

function play(job: Job) {
  const t = performance.now();
  let state = createGame(db, {
    seed: job.seed,
    players: [
      { id: "p1", leader: job.p1.leader, deck: expand(job.p1) },
      { id: "p2", leader: job.p2.leader, deck: expand(job.p2) },
    ],
    firstPlayer: job.first,
  }).state;
  const agents = {
    p1: createProAgent(`${job.seed}:p1`, job.p1.skill),
    p2: createProAgent(`${job.seed}:p2`, job.p2.skill),
  };
  let steps = 0, fellBack = 0;
  while (state.phase !== "over" && steps < job.maxSteps) {
    const step = agentStep(db, state, agents[actorOf(db, state)]);
    state = step.state;
    if (step.fellBack) fellBack++;
    steps++;
  }
  return { winner: state.phase === "over" ? state.winner ?? null : null, turn: state.turn, steps, fellBack, ms: Math.round(performance.now() - t) };
}

parentPort.on("message", (job: Job) => {
  try {
    parentPort.postMessage({ id: job.id, ...play(job) });
  } catch (err) {
    parentPort.postMessage({ id: job.id, winner: null, error: String((err as Error)?.stack ?? err) });
  }
});
