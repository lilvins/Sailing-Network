import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // expose on LAN so a phone can connect for touch testing
    // let a temporary `cloudflared tunnel` reach the dev server from outside
    allowedHosts: [".trycloudflare.com"],
    // the frontend imports nothing from these, and every DB write touches
    // server/sailing.db-journal: watching them reloads every open page
    watch: { ignored: ["**/server/**", "**/scripts/.*/**", "**/_Reports/**"] },
    proxy: {
      // forward API calls to the local backend → same-origin requests, so the
      // httpOnly session cookie works without any CORS/SameSite gymnastics.
      "/api": {
        // SN_API_PORT lets a second dev copy run beside the first (scripts/dev-alt.mjs)
        target: `http://localhost:${process.env.SN_API_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
