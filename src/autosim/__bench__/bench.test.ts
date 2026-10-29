// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { writeFileSync } from "node:fs";
// @ts-expect-error — same: Node's built-in inspector, used only when profiling
import { Session } from "node:inspector/promises";
import { describe, it } from "vitest";
import { metaDecks, metaGameConfig, playRandomGame, type ApplyMode } from "./metaGames";

/**
 * AUTOSIM speed benchmark — skipped in the normal suite, run with
 * `npm run bench:autosim` (scripts/bench-autosim.mjs sets BENCH=1).
 * Plays BENCH_ROUNDS × (number of meta decks) random games in each mode —
 * "game" (a copy per intent, like the table) and "rollout" (in place, like the
 * bot) — and writes one JSON result to the file named by BENCH_OUT. With
 * BENCH_PROF set, it also records a CPU profile of the rollout games there
 * (from inside this process: vitest stops its workers before Node's
 * --cpu-prof could write one).
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(!env.BENCH)("AUTOSIM benchmark", () => {
  it("plays the meta decks against each other", async () => {
    const rounds = Number(env.BENCH_ROUNDS ?? 4);
    // one throwaway game so JIT warm-up does not count
    playRandomGame(metaGameConfig(0, 99));

    const game = measure("game", rounds);
    const profiler = env.BENCH_PROF ? await startProfiler() : null;
    const rollout = measure("rollout", rounds);
    if (profiler) writeFileSync(env.BENCH_PROF, JSON.stringify(await stopProfiler(profiler)));

    writeFileSync(env.BENCH_OUT ?? "bench-autosim.json", JSON.stringify({ game, rollout }));
  }, 30 * 60_000);
});

function measure(mode: ApplyMode, rounds: number) {
  let games = 0, intents = 0, capped = 0;
  const ms = { create: 0, decide: 0, apply: 0 };
  const started = performance.now();
  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < metaDecks.length; i++) {
      const run = playRandomGame(metaGameConfig(i, round), mode);
      games++; intents += run.intents;
      if (run.capped) capped++;
      ms.create += run.ms.create; ms.decide += run.ms.decide; ms.apply += run.ms.apply;
    }
  }
  const total = performance.now() - started;
  return {
    games, capped, intents,
    gamesPerSec: +(games / (total / 1000)).toFixed(1),
    msPerGame: +(total / games).toFixed(1),
    usPerIntent: { decide: Math.round((ms.decide / intents) * 1000), apply: Math.round((ms.apply / intents) * 1000) },
  };
}

async function startProfiler() {
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.start");
  return session;
}

async function stopProfiler(session: { post(m: string): Promise<{ profile: unknown }>; disconnect(): void }) {
  const { profile } = await session.post("Profiler.stop");
  session.disconnect();
  return profile;
}
