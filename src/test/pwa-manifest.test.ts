import fs from "node:fs";

type PwaManifest = {
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  display_override?: string[];
  launch_handler?: { client_mode?: string };
  icons?: Array<{ src?: string; sizes?: string; type?: string }>;
};

describe("PWA manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync("public/manifest.webmanifest", "utf8"),
  ) as PwaManifest;

  it("launches the slideshow as one stable, chrome-free application", () => {
    expect(manifest).toMatchObject({
      id: "/",
      start_url: "/slideshow",
      scope: "/",
      display: "standalone",
      display_override: ["fullscreen", "standalone"],
      launch_handler: { client_mode: "navigate-existing" },
    });
  });

  it("declares install and Apple home-screen icon sizes", () => {
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/pwa-icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/pwa-icon-512.png", sizes: "512x512" }),
      ]),
    );
  });
});
