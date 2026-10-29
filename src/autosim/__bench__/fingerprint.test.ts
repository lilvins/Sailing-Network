// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createGame } from "../engine/engine";
import { seededRng } from "../../lib/rng";
import { randomIntent } from "../ai/random";
import { metaDecks, metaGameConfig, playRandomGame, realDb, type ApplyMode } from "./metaGames";

/**
 * Game fingerprints: one seeded random game per meta deck, hashed event by
 * event. Speed work on the engine (phase 1 of PLAN_BOT_AUTOSIM.md) must keep
 * every fingerprint identical — otherwise it changed a rule, not just the speed.
 * Both entry points must play the same games: applyIntent (the table) and
 * applyIntentInPlace (the bot's rollouts).
 * When a rule change is intended: UPDATE_FINGERPRINT=1 npx vitest run fingerprint
 */
const FILE = new URL("./fingerprint.json", import.meta.url);
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

function fingerprints(mode: ApplyMode): Record<string, string> {
  const out: Record<string, string> = {};
  metaDecks.forEach((_, i) => {
    const config = metaGameConfig(i);
    out[config.seed] = playRandomGame(config, mode).fingerprint;
  });
  return out;
}

describe("engine fingerprint on the meta decks", () => {
  it("every game is identical to the recorded one", () => {
    const now = fingerprints("game");
    if (env.UPDATE_FINGERPRINT || !existsSync(FILE)) {
      writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
      return;
    }
    expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  }, 60_000);

  it("the rollout entry point (in place) plays exactly the same games", () => {
    expect(fingerprints("rollout")).toEqual(fingerprints("game"));
  }, 60_000);

  it("applyIntent never changes the state of the real game", () => {
    const config = metaGameConfig(0);
    const rng = seededRng(`driver:${config.seed}`);
    let state = createGame(realDb, config).state;
    while (state.phase !== "over") {
      const before = JSON.stringify(state);
      const next = applyIntent(realDb, state, randomIntent(realDb, state, rng)).state;
      expect(JSON.stringify(state)).toBe(before);
      expect(next).not.toBe(state);
      state = next;
    }
  }, 60_000);
});
