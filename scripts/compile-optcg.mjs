// Regenerates src/autosim/data/compiled/generated/{optcg,report}.json from
// public/data/optcg/bundle.json (optcg-ai's card effects) through
// src/autosim/compiler/fromOptcg.ts, then generated/meta-report.json (how
// automatic each meta deck is in board-auto, read from the NEW optcg.json —
// hence a separate run), then runs all the checks.
//   npm run compile:optcg          (after optcg-ai's `npm run sync-sn`)
import { spawnSync } from "node:child_process";

const M5 = "src/autosim/__tests__/m5-optcg.test.ts";
const META = "src/autosim/__tests__/meta-report.test.ts";
const run = (files, env) => spawnSync("npx", ["vitest", "run", ...files], {
  stdio: "inherit", shell: true, env: { ...process.env, ...env },
});
for (const step of [[[M5], { UPDATE_OPTCG: "1" }], [[META], { UPDATE_OPTCG: "1" }], [[M5, META], {}]]) {
  const r = run(...step);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
