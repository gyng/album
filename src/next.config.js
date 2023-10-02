/** @type {import('next').NextConfig} */
const nextConfig = {
  // Breaks sqlite init
  // reactStrictMode: true,
  swcMinify: true,
  staticPageGenerationTimeout: 300,
  // Needed as CORP/COEP via service worker kills cross-domain stuff
  async rewrites() {
    return [
      {
        source: "/osm/:s/:z/:x/:y",
        destination: "https://:s.tile.openstreetmap.org/:z/:x/:y.png",
      },
    ];
  },
};

module.exports = nextConfig;
