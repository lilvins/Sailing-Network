/**
 * What the server needs of AUTOSIM, as one entry point.
 *
 * The API server is plain JavaScript and cannot import these TypeScript
 * modules as they are. `server/engineBuild.mjs` bundles this file into one
 * JavaScript module (at `npm run build`, or when the server starts in dev),
 * and `server/engine.mjs` loads it. With it the server plays a ranked game
 * itself: it refuses an illegal move and it knows who won.
 *
 * Keep it small: every export here is code the server runs.
 */
export { createGame, applyIntent } from "./engine/engine";
export { makeCardDb } from "../features/board-auto/compile";
// a ranked table shows each player their own view of the game
export { viewOf, redactSetup, redactPlay, resolveIntent, redactText } from "./view";
