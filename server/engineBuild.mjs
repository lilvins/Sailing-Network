// engineBuild.mjs — turns the rules engine (src/autosim, TypeScript) into one
// JavaScript module the server can load: src/autosim/serverEngine.ts, bundled.
//
// Two callers: the site's build (vite.config.ts), which writes it to
// dist/_server/engine.mjs for production, and server/engine.mjs, which builds
// it into a temp folder when the server starts in dev or in the tests.
// esbuild comes with Vite: a dev dependency, absent from the production image.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_ENTRY = join(ROOT, "src", "autosim", "serverEngine.ts");
/** Where the site's build puts the bundle. Inside dist, but never served (static.mjs). */
export const BUILT_ENGINE = join(ROOT, "dist", "_server", "engine.mjs");

/** Writes the bundle to `outfile`. Throws when esbuild is not installed or the sources do not compile. */
export async function buildEngine(outfile) {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [ENGINE_ENTRY],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "silent",
  });
  return outfile;
}
