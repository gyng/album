const path = require("path");

const isVercelBuild = process.env.VERCEL === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  staticPageGenerationTimeout: 300,
  outputFileTracingRoot: isVercelBuild ? __dirname : path.join(__dirname, ".."),
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
