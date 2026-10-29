// Pro vs Greedy gauntlet on AUTOSIM (src/autosim/__bench__/gauntlet.test.ts):
// paired games on the meta decks of the test account, JSON summary on stdout.
//   npm run gauntlet:autosim                                   (8 decks × 1 opponent)
//   npm run gauntlet:autosim -- --decks 17 --rounds 4 --pro '{"horizon":2}'
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const work = mkdtempSync(join(tmpdir(), "autosim-gauntlet-"));
const out = join(work, "result.json");
const env = {
  ...process.env, GAUNTLET: "1", GAUNTLET_OUT: out,
  GAUNTLET_DECKS: opt("--decks", "8"), GAUNTLET_ROUNDS: opt("--rounds", "1"), GAUNTLET_PRO: opt("--pro", ""),
};
const r = spawnSync("npx", ["vitest", "run", "src/autosim/__bench__/gauntlet.test.ts"], { shell: true, env, encoding: "utf8" });
if (r.status !== 0 || !existsSync(out)) {
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  process.exit(r.status || 1);
}
console.log(readFileSync(out, "utf8"));
rmSync(work, { recursive: true, force: true });
