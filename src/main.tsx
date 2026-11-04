import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (no external CDN) — weights used across the design.
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/sora/800.css";
import "./index.css";
import { App } from "./app/App.tsx";
// after App (and every page's CSS): the site-wide pixel UI restyles them
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css";
import "./features/pixel/index.css";
import "./features/pixel/percent-glyph.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
