import { readFile } from "node:fs/promises";

const dir = process.argv[2];
if (!dir) { console.error("uso: node scripts/check-drift.mjs vendor/optcg/<hash>"); process.exit(2); }
const manifest = JSON.parse(await readFile(dir + "/manifest.json", "utf8"));

const html = await (await fetch("https://optcgwebsim.com/")).text();
const idxPath = "/assets/" + html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)[1];
const idx = await (await fetch("https://optcgwebsim.com" + idxPath)).text();
const workerPath = "/assets/" + idx.match(/\/assets\/(ai\.worker-[A-Za-z0-9_-]+\.js)/)[1];

if (workerPath !== manifest.worker) {
  console.error(`DRIFT: worker ${manifest.worker} -> ${workerPath}`);
  process.exit(1);
}
console.log("ok: worker invariato", workerPath);
