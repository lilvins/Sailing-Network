// dev-alt.mjs — a second dev copy (API :8817, UI :5193) next to `npm run dev`,
// e.g. when another session already holds :8787/:5173. Same database.
//   npm run dev:alt
import { spawn } from "node:child_process";

const env = { ...process.env, SN_API_PORT: "8817" };
const run = (args) => spawn(process.execPath, args, { env, stdio: "inherit" });
const api = run(["server/index.mjs"]);
const ui = run(["node_modules/vite/bin/vite.js", "--port", "5193", "--strictPort"]);
const stop = () => { api.kill(); ui.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
