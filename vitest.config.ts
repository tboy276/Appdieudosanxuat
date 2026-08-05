import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 90000,
    hookTimeout: 90000,
    setupFiles: ["./vitest.setup.ts"],

  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
