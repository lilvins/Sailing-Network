import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5183, // bot copy (the main checkout uses 5173)
    strictPort: true,
    host: true, // expose on LAN so a phone can connect for touch testing
    // let a temporary `cloudflared tunnel` reach the dev server from outside
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      // forward API calls to the local backend → same-origin requests, so the
      // httpOnly session cookie works without any CORS/SameSite gymnastics.
      "/api": {
        target: "http://localhost:8797",
        changeOrigin: true,
      },
    },
  },
});
