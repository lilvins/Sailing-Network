// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { writeFileSync } from "node:fs";
// @ts-expect-error — same: Node's built-in inspector, used only when profiling
import { Session } from "node:inspector/promises";
import { describe, it } from "vitest";
import { metaDecks, metaGameConfig, playRandomGame } from "./metaGames";

/**
 * AUTOSIM speed benchmark — skipped in the normal suite, run with
 * `npm run bench:autosim` (scripts/bench-autosim.mjs sets BENCH=1).
 * Plays BENCH_ROUNDS × (number of meta decks) random games and writes one
 * JSON result to the file named by BENCH_OUT. With BENCH_PROF set, it also
 * records a CPU profile of the games there (from inside this process: vitest
 * stops its workers before Node's --cpu-prof could write one).
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(!env.BENCH)("AUTOSIM benchmark", () => {
  it("plays the meta decks against each other", async () => {
    const rounds = Number(env.BENCH_ROUNDS ?? 4);
    // one throwaway game so JIT warm-up does not count
    playRandomGame(metaGameConfig(0, 99));

    const profiler = env.BENCH_PROF ? await startProfiler() : null;
    let games = 0, intents = 0, events = 0, capped = 0;
    const ms = { create: 0, decide: 0, apply: 0 };
    const started = performance.now();
    for (let round = 1; round <= rounds; round++) {
      for (let i = 0; i < metaDecks.length; i++) {
        const run = playRandomGame(metaGameConfig(i, round));
        games++; intents += run.intents; events += run.events;
        if (run.capped) capped++;
        ms.create += run.ms.create; ms.decide += run.ms.decide; ms.apply += run.ms.apply;
      }
    }
    const total = performance.now() - started;
    if (profiler) writeFileSync(env.BENCH_PROF, JSON.stringify(await stopProfiler(profiler)));

    writeFileSync(env.BENCH_OUT ?? "bench-autosim.json", JSON.stringify({
      games, capped, intents, events,
      totalMs: Math.round(total),
      gamesPerSec: +(games / (total / 1000)).toFixed(1),
      msPerGame: +(total / games).toFixed(1),
      intentsPerGame: Math.round(intents / games),
      usPerIntent: { decide: Math.round((ms.decide / intents) * 1000), apply: Math.round((ms.apply / intents) * 1000) },
      share: { create: pct(ms.create, total), decide: pct(ms.decide, total), apply: pct(ms.apply, total) },
    }));
  }, 30 * 60_000);
});

const pct = (part: number, total: number) => `${Math.round((part / total) * 100)}%`;

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
