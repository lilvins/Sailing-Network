// Trains the evaluation weights of the AUTOSIM Pro bot by self-play.
// Each trial changes ONE weight by ±step, plays `pairs` paired matches
// (candidate weights vs current weights, random meta matchups, seats swapped)
// and adopts the change only if the candidate wins significantly more
// (one-sided sign test, p < alpha) AND confirms it on as many fresh games.
// Every trial is logged in
// src/autosim/ai/learned.json and summarized in docs/bot/allenamento.md.
//   npm run train:autosim                                  (3000 games)
//   npm run train:autosim -- --games 10000 --pairs 50 --workers 10
//   npm run train:autosim -- --budget '{"rollouts":4}'     (faster, rougher)
// Resumable: it starts from the weights already in learned.json.
import { buildSync } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const TOTAL_GAMES = Number(opt("--games", "3000"));
const PAIRS = Number(opt("--pairs", "50"));
const WORKERS = Number(opt("--workers", String(Math.max(1, cpus().length - 2))));
const STEP = Number(opt("--step", "0.25"));
const ALPHA = Number(opt("--alpha", "0.05"));
const BUDGET = JSON.parse(opt("--budget", "{}"));
const RUN = opt("--seed", new Date().toISOString().slice(0, 16));

/** Weights training may change (integers like expendableCost stay as written). */
const KEYS = ["lethalBonus", "pressure", "counter", "lifeConvex", "oppLifeBase", "myLifeBase", "hand", "oppHand", "chars", "blocker", "don", "rested", "roleShift", "powerDivisor"];

const LEARNED = "src/autosim/ai/learned.json";
const REPORT = "docs/bot/allenamento.md";

// --- bundle the pure TypeScript match runner once, for the main thread and the workers
const work = mkdtempSync(join(tmpdir(), "autosim-train-"));
const bundle = join(work, "match.mjs");
buildSync({ entryPoints: ["src/autosim/train/match.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "error" });
const workerFile = join(work, "worker.mjs");
writeFileSync(workerFile, `
import { parentPort } from "node:worker_threads";
const { playPair } = await import(${JSON.stringify(pathToFileURL(bundle).href)});
parentPort.on("message", (m) => parentPort.postMessage({ id: m.id, result: playPair(m.candidate, m.base, m.index, m.run, m.budget) }));
`);
const { startWeights } = await import(pathToFileURL(bundle).href);

// --- worker pool
const pool = Array.from({ length: WORKERS }, () => new Worker(workerFile));
const idle = [...pool];
const waiting = [];
const pending = new Map();
let nextId = 0;
for (const w of pool) {
  w.on("message", ({ id, result }) => {
    pending.get(id)(result);
    pending.delete(id);
    const job = waiting.shift();
    if (job) job(w); else idle.push(w);
  });
  w.on("error", (e) => { console.error("worker error", e); process.exit(1); });
}
function run(msg) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    const send = (w) => w.postMessage({ ...msg, id });
    const w = idle.pop();
    if (w) send(w); else waiting.push(send);
  });
}

// --- statistics: one-sided sign test, P(X >= wins) with X ~ Bin(n, 1/2)
function signTestP(wins, n) {
  let p = 0, c = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) c = (c * (n - k + 1)) / k;
    if (k >= wins) p += c;
  }
  return p / 2 ** n;
}

// --- training loop
const learned = JSON.parse(readFileSync(LEARNED, "utf8"));
const { base } = startWeights();
let current = { ...base, ...learned.eval };
let games = 0, trial = learned.log.length, matchIndex = 0;
const started = Date.now();
console.log(`training: ${TOTAL_GAMES} games, ${PAIRS} pairs/trial, ${WORKERS} workers, step ±${STEP * 100}%, alpha ${ALPHA}, run ${RUN}`);

while (games + PAIRS * 2 <= TOTAL_GAMES) {
  const key = KEYS[trial % KEYS.length];
  const up = Math.floor(trial / KEYS.length) % 2 === 0;
  const from = current[key];
  const to = round(from * (up ? 1 + STEP : 1 - STEP));
  const candidate = { ...current, [key]: to };
  const first = await playBatch(candidate, current);
  // a win must be confirmed on fresh games: with ~100 trials at alpha 0.05 about 5
  // "wins" are luck (2026-10-29: the only adoption of the first night was one)
  const second = first.p < ALPHA ? await playBatch(candidate, current) : null;
  const adopted = !!second && second.p < ALPHA;
  if (adopted) current = candidate;
  const { wins, losses, unfinished, p } = first;
  const confirm = second ? { confirmWins: second.wins, confirmLosses: second.losses, confirmP: round(second.p, 4) } : {};
  const entry = { trial, at: new Date().toISOString(), key, from, to, wins, losses, unfinished, p: round(p, 4), ...confirm, adopted };
  learned.log.push(entry);
  learned.eval = diff(current, base);
  learned.updatedAt = entry.at;
  learned.gamesPlayed = (learned.gamesPlayed ?? 0) + PAIRS * 2;
  writeFileSync(LEARNED, JSON.stringify(learned, null, 2) + "\n");
  writeFileSync(REPORT, report(learned, base, current));
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const verdict = adopted ? "ADOPTED (confirmed)" : second ? `not confirmed (${second.wins}-${second.losses})` : "kept";
  console.log(`#${trial} ${key} ${from} → ${to}: ${wins}-${losses} (${unfinished} unfinished) p=${entry.p} ${verdict} · ${games}/${TOTAL_GAMES} games · ${mins} min`);
  trial++;
}

await Promise.all(pool.map((w) => w.terminate()));
rmSync(work, { recursive: true, force: true });

/** PAIRS paired matches candidate vs base on fresh deals; wins, losses and the sign-test p. */
async function playBatch(candidate, base) {
  const results = await Promise.all(
    Array.from({ length: PAIRS }, () => run({ candidate, base, index: matchIndex++, run: RUN, budget: BUDGET })),
  );
  games += PAIRS * 2;
  const wins = results.reduce((s, r) => s + r.candidateWins, 0);
  const losses = results.reduce((s, r) => s + r.baseWins, 0);
  const unfinished = results.reduce((s, r) => s + r.unfinished, 0);
  return { wins, losses, unfinished, p: signTestP(wins, wins + losses) };
}

function round(x, digits = 3) { const f = 10 ** digits; return Math.round(x * f) / f; }
function diff(w, b) { return Object.fromEntries(Object.entries(w).filter(([k, v]) => b[k] !== v)); }

function report(l, b, w) {
  const rows = Object.keys(b).map((k) => `| ${k} | ${b[k]} | ${w[k]} | ${w[k] === b[k] ? "" : w[k] > b[k] ? "↑" : "↓"} |`);
  const trials = l.log.slice(-60).reverse().map((e) => `| ${e.trial} | ${e.key} | ${e.from} → ${e.to} | ${e.wins}-${e.losses} | ${e.p} | ${e.adopted ? "**adottato**" : "scartato"} |`);
  return `# Allenamento del bot — cosa ha imparato

> Generato da \`npm run train:autosim\`. Ultimo aggiornamento: ${l.updatedAt}. Partite giocate in tutto: ${l.gamesPlayed}.
> Teoria dei pesi: [teoria-del-vantaggio.md](teoria-del-vantaggio.md). Un cambio si adotta solo se il Pro con il peso nuovo batte quello col peso attuale in modo significativo (test dei segni, p < ${ALPHA}) e lo conferma su altrettante partite nuove.

## Pesi attuali

| Peso | Di partenza | Adesso | |
|---|---|---|---|
${rows.join("\n")}

## Ultimi tentativi (dal più recente)

| # | Peso | Cambio | Vinte-perse | p | Esito |
|---|---|---|---|---|---|
${trials.join("\n")}
`;
}
