import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Standalone local tool. Shares pure logic from ../../src/util via the @shared
// alias; the Hono API (server/) is proxied so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../src/util"),
      "@sharedTypes": path.resolve(__dirname, "../../src/services"),
      // Shared sources resolve bare imports from src/ by default. Keep this
      // standalone tool bound to the dependency installed in its own package.
      "fast-xml-parser": path.resolve(__dirname, "node_modules/fast-xml-parser/src/fxp.js"),
    },
  },
  server: {
    port: 5175,
    proxy: {
      "/api": "http://localhost:8788",
    },
  },
});
