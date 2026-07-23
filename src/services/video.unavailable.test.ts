/**
 * @jest-environment node
 */

import fs from "node:fs";

jest.mock("node:child_process", () => ({ spawn: jest.fn() }));
jest.mock("ffmpeg-static", () => ({ __esModule: true, default: null }));
jest.mock("ffprobe-static", () => ({ __esModule: true, default: { path: null } }));
jest.mock("./photo", () => ({ stripPublicFromPath: jest.fn() }));

import { getOriginalVideoTechnicalData, optimiseVideo } from "./video";

describe("video tools without bundled binaries", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it("returns no probe metadata when ffprobe is unavailable", async () => {
    await expect(getOriginalVideoTechnicalData("clip.mp4")).resolves.toEqual({});
  });

  it("rejects encoding after invalidating a cache when ffmpeg is unavailable", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 10 } as fs.Stats);
    jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(optimiseVideo("albums/trip/clip.mov", "public/data/albums")).rejects.toThrow(
      "ffmpeg binary is unavailable",
    );
  });
});
