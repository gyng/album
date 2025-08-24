/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  staticPageGenerationTimeout: 300,
  turbopack: {
    root: ".",
  },
};

module.exports = nextConfig;
