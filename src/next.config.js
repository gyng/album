const path = require("path");

const isVercelBuild = process.env.VERCEL === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  staticPageGenerationTimeout: 300,
  outputFileTracingRoot: isVercelBuild ? __dirname : path.join(__dirname, ".."),
  serverExternalPackages: ["sharp", "ffmpeg-static", "ffprobe-static", "sqlite3"],
  experimental: {
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
