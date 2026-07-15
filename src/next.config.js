const path = require("path");

const isVercelBuild = process.env.VERCEL === "1";
const hasExternalTypecheck = process.env.ALBUM_SKIP_NEXT_TYPECHECK === "1";
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const searchDatabaseUrl = process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL ?? "/search.sqlite";
const searchEmbeddingsDatabaseUrl =
  process.env.NEXT_PUBLIC_SEARCH_EMBEDDINGS_DATABASE_URL ?? "/search-embeddings.sqlite";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir,
  // Turbopack can otherwise leave these client-side lookups as runtime
  // `process.env` access. Declare them here so each build embeds the selected
  // production or isolated E2E database URLs.
  env: {
    NEXT_PUBLIC_SEARCH_DATABASE_URL: searchDatabaseUrl,
    NEXT_PUBLIC_SEARCH_EMBEDDINGS_DATABASE_URL: searchEmbeddingsDatabaseUrl,
  },
  staticPageGenerationTimeout: 300,
  outputFileTracingRoot: isVercelBuild ? __dirname : path.join(__dirname, ".."),
  serverExternalPackages: ["sharp", "ffmpeg-static", "ffprobe-static", "sqlite3"],
  // `npm run build` runs the repository's native TypeScript checker first.
  // Keep direct `next build` invocations safe by skipping Next's slower check
  // only when that explicit gate has completed successfully.
  typescript: {
    ignoreBuildErrors: hasExternalTypecheck,
  },
  headers: async () => [
    {
      source: "/feed.xml",
      headers: [{ key: "Content-Type", value: "application/rss+xml; charset=utf-8" }],
    },
    {
      source: "/album/:slug/feed.xml",
      headers: [{ key: "Content-Type", value: "application/rss+xml; charset=utf-8" }],
    },
    {
      source: "/sitemap.xml",
      headers: [{ key: "Content-Type", value: "application/xml; charset=utf-8" }],
    },
  ],
  experimental: {
    scrollRestoration: true,
    useLightningcss: true,
    lightningCssFeatures: {
      exclude: ["light-dark"],
    },
  },
  outputFileTracingExcludes: {
    "**": [
      "node_modules/ffmpeg-static/**",
      "node_modules/ffprobe-static/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/sqlite3/build/**",
      "node_modules/@sqlite.org/**",
      "public/data/**",
      "test/**",
    ],
  },
};

module.exports = nextConfig;
