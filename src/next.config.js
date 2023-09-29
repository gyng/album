/** @type {import('next').NextConfig} */
const nextConfig = {
  // Breaks sqlite init
  // reactStrictMode: true,
  swcMinify: true,
  staticPageGenerationTimeout: 300,
};

module.exports = nextConfig;
