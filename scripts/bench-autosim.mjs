// AUTOSIM speed benchmark: random games between the meta decks of the test
// account (src/autosim/__bench__/bench.test.ts), then — with --profile — a
// CPU profile of the same run reduced to the functions that cost the most.
//   npm run bench:autosim                  (4 rounds × 17 decks)
//   npm run bench:autosim -- --rounds 8 --profile
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const rounds = args.includes("--rounds") ? args[args.indexOf("--rounds") + 1] : "4";
const profile = args.includes("--profile");
const TOP = 12;

const work = mkdtempSync(join(tmpdir(), "autosim-bench-"));
const out = join(work, "result.json");
const prof = join(work, "games.cpuprofile");
const env = { ...process.env, BENCH: "1", BENCH_ROUNDS: rounds, BENCH_OUT: out, ...(profile ? { BENCH_PROF: prof } : {}) };
const r = spawnSync("npx", ["vitest", "run", "src/autosim/__bench__/bench.test.ts"], { shell: true, env, encoding: "utf8" });
if (r.status !== 0 || !existsSync(out)) {
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  process.exit(r.status || 1);
}
const result = JSON.parse(readFileSync(out, "utf8"));
console.log(JSON.stringify(result, null, 2));

if (profile) printHotspots(JSON.parse(readFileSync(prof, "utf8")));
rmSync(work, { recursive: true, force: true });

/** Self time per function (time spent in its own code, not in what it calls). */
function printHotspots(prof) {
  const selfUs = new Map();
  const dt = prof.timeDeltas;
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  prof.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    const where = f.url ? relative(process.cwd(), decodeURIComponent(f.url.replace(/^file:\/\/\/?/, ""))).replace(/\\/g, "/") : "(native)";
    const key = `${f.functionName || "(anonymous)"}  ${where}:${f.lineNumber + 1}`;
    selfUs.set(key, (selfUs.get(key) ?? 0) + (dt[i] ?? 0));
  });
  const total = [...selfUs.values()].reduce((a, b) => a + b, 0);
  console.log(`\nTop ${TOP} by self time (${Math.round(total / 1000)} ms profiled):`);
  [...selfUs.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)
    .forEach(([k, us]) => console.log(`  ${((us / total) * 100).toFixed(1).padStart(5)}%  ${k}`));
}
