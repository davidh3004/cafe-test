import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    // Environment stays node — each test builds its own JSDOM window.
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
