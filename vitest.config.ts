import { defineConfig } from "vitest/config";

// Standalone vitest config: the unit tests target the pure game-state layer,
// so we skip vite.config.ts (react/tailwind plugins) entirely.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
