// @ts-expect-error — the app tsconfig carries no Node type definitions; vitest runs on Node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metaDecks, metaGameConfig, playRandomGame } from "./metaGames";

/**
 * Game fingerprints: one seeded random game per meta deck, hashed event by
 * event. Speed work on the engine (phase 1 of PLAN_BOT_AUTOSIM.md) must keep
 * every fingerprint identical — otherwise it changed a rule, not just the speed.
 * When a rule change is intended: UPDATE_FINGERPRINT=1 npx vitest run fingerprint
 */
const FILE = new URL("./fingerprint.json", import.meta.url);
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe("engine fingerprint on the meta decks", () => {
  it("every game is identical to the recorded one", () => {
    const now: Record<string, string> = {};
    metaDecks.forEach((_, i) => {
      const config = metaGameConfig(i);
      now[config.seed] = playRandomGame(config).fingerprint;
    });
    if (env.UPDATE_FINGERPRINT || !existsSync(FILE)) {
      writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
      return;
    }
    expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  }, 60_000);
});
