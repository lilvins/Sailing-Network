import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const ORIGIN = "https://optcgwebsim.com";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const get = async (u) => {
  const r = await fetch(ORIGIN + u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const html = (await get("/")).toString();
const idxPath = "/assets/" + html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)[1];
const idx = (await get(idxPath)).toString();
const workerPath = "/assets/" + idx.match(/\/assets\/(ai\.worker-[A-Za-z0-9_-]+\.js)/)[1];

const files = { [workerPath]: await get(workerPath) };
for (const d of ["/data/cards.json", "/data/playbooks.json", "/data/formats.json"]) files[d] = await get(d);

const manifest = {
  fetchedAt: new Date().toISOString(),
  index: idxPath,
  worker: workerPath,
  sha256: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)]))
};

const dir = `vendor/optcg/${manifest.sha256[workerPath].slice(0, 12)}`;
await mkdir(dir, { recursive: true });
for (const [k, v] of Object.entries(files)) await writeFile(`${dir}/${k.split("/").pop()}`, v);
await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log("pinned ->", dir);
console.log(JSON.stringify(manifest, null, 2));
