import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config so tests resolve the shared @shared modules the same
// way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../src/util"),
      "@sharedTypes": path.resolve(__dirname, "../../src/services"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
