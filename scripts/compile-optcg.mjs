// Regenerates src/autosim/data/compiled/generated/{optcg,report}.json from
// public/data/optcg/bundle.json (optcg-ai's card effects) through
// src/autosim/compiler/fromOptcg.ts, then runs the M5 checks on the result.
//   npm run compile:optcg          (after optcg-ai's `npm run sync-sn`)
import { spawnSync } from "node:child_process";

const run = (env) => spawnSync("npx", ["vitest", "run", "src/autosim/__tests__/m5-optcg.test.ts"], {
  stdio: "inherit", shell: true, env: { ...process.env, ...env },
});
const gen = run({ UPDATE_OPTCG: "1" });
if (gen.status !== 0) process.exit(gen.status ?? 1);
process.exit(run({}).status ?? 1);
