/** @type {import('next').NextConfig} */
const nextConfig = {
  // reactStrictMode: true,
  swcMinify: true,
  staticPageGenerationTimeout: 300,
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  async headers() {
    return [
      // This doesn't work: on Vercel
      // I think it's because Vercel does its own stuff
      // {
      //   source: "/_next/:path*",
      //   headers: [
      //     {
      //       key: "Cross-Origin-Embedder-Policy",
      //       value: "require-corp",
      //     },
      //     {
      //       key: "Cross-Origin-Opener-Policy",
      //       value: "same-origin",
      //     },
      //   ],
      // },
      {
        source: "/",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
      // Needed for OSM map tiles
      {
        source: "/album/:path",
        headers: [
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-site",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
