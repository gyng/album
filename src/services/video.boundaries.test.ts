/**
 * @jest-environment node
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";

jest.mock("node:child_process", () => ({ spawn: jest.fn() }));
jest.mock("ffmpeg-static", () => ({ __esModule: true, default: "/bin/ffmpeg-test" }));
jest.mock("ffprobe-static", () => ({ __esModule: true, default: { path: "/bin/ffprobe-test" } }));
jest.mock("./photo", () => ({
  stripPublicFromPath: (value: string) => `/built/${value.split("/").at(-1)}`,
}));

import { spawn } from "node:child_process";
import {
  buildOriginalVideoTechnicalData,
  getOriginalVideoTechnicalData,
  optimiseVideo,
  OPTIMISED_VIDEO_AUDIO_BITRATE,
  OPTIMISED_VIDEO_CRF,
  OPTIMISED_VIDEO_MAX_WIDTH,
  OPTIMISED_VIDEO_PRESET,
  RESIZED_VIDEO_DIR,
  VIDEO_EXTENSIONS,
  VIDEO_VALIDATION_SECONDS,
  VIDEO_VALIDATION_TIMEOUT_MS,
} from "./video";

const mockSpawn = jest.mocked(spawn);

type FakeProcess = EventEmitter & {
  stderr: EventEmitter;
  stdout: EventEmitter;
  kill: jest.Mock;
};

const fakeProcess = (): FakeProcess => {
  const proc = new EventEmitter() as FakeProcess;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
};

type ProcessScenario = (proc: FakeProcess) => void;

describe("video process boundaries", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let scenarios: ProcessScenario[];

  beforeEach(() => {
    scenarios = [];
    mockSpawn.mockReset().mockImplementation(() => {
      const proc = fakeProcess();
      const scenario = scenarios.shift();
      queueMicrotask(() => scenario?.(proc));
      return proc as never;
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it("exports the production encoding and validation contract", () => {
    expect({
      maxWidth: OPTIMISED_VIDEO_MAX_WIDTH,
      preset: OPTIMISED_VIDEO_PRESET,
      crf: OPTIMISED_VIDEO_CRF,
      audioBitrate: OPTIMISED_VIDEO_AUDIO_BITRATE,
      validationSeconds: VIDEO_VALIDATION_SECONDS,
      validationTimeout: VIDEO_VALIDATION_TIMEOUT_MS,
      cacheDirectory: RESIZED_VIDEO_DIR,
      extensions: VIDEO_EXTENSIONS,
    }).toEqual({
      maxWidth: 1920,
      preset: "medium",
      crf: 30,
      audioBitrate: "96k",
      validationSeconds: "0.25",
      validationTimeout: 4000,
      cacheDirectory: ".resized_videos",
      extensions: [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"],
    });
  });

  it("maps full ffprobe metadata with format and frame-rate fallbacks", () => {
    expect(
      buildOriginalVideoTechnicalData(
        {
          streams: [
            {
              codec_type: "video",
              codec_name: "hevc",
              profile: "Main",
              r_frame_rate: "30000/1001",
              bit_rate: "12000000",
              duration: "12.3456",
              width: "3840",
              height: "2160",
            },
            { codec_type: "audio", codec_name: "aac" },
          ],
          format: {
            format_name: "mov,mp4",
            tags: { creation_time: "2024-01-02T03:04:05Z" },
          },
        },
        12345,
      ),
    ).toEqual({
      originalDate: "2024-01-02T03:04:05.000Z",
      codec: "hevc",
      profile: "Main",
      fps: 29.97,
      bitrateKbps: 12000,
      fileSizeBytes: 12345,
      durationSeconds: 12.346,
      width: 3840,
      height: 2160,
      audioCodec: "aac",
      container: "mov,mp4",
    });
  });

  it.each([
    [{ streams: [{ codec_type: "video", avg_frame_rate: "30" }] }, undefined],
    [{ streams: [{ codec_type: "video", avg_frame_rate: "abc/1" }] }, undefined],
    [{ streams: [{ codec_type: "video", avg_frame_rate: "30/abc" }] }, undefined],
    [{ streams: [{ codec_type: "video", avg_frame_rate: "30/0" }] }, undefined],
    [{ streams: [{ codec_type: "video", tags: { creation_time: "not-a-date" } }] }, undefined],
    [{}, undefined],
  ])("omits invalid optional ffprobe values", (parsed, expectedFps) => {
    const result = buildOriginalVideoTechnicalData(parsed);

    expect(result.fps).toBe(expectedFps);
    expect(Object.values(result)).not.toContain(undefined);
  });

  it("returns empty metadata for process errors, non-zero exits, and malformed JSON", async () => {
    scenarios.push(
      (proc) => proc.emit("error", new Error("spawn failed")),
      (proc) => proc.emit("close", 2),
      (proc) => {
        proc.stdout.emit("data", Buffer.from("not json"));
        proc.emit("close", 0);
      },
    );

    await expect(getOriginalVideoTechnicalData("error.mp4")).resolves.toEqual({});
    await expect(getOriginalVideoTechnicalData("exit.mp4")).resolves.toEqual({});
    await expect(getOriginalVideoTechnicalData("bad-json.mp4")).resolves.toEqual({});
  });

  it("reads valid ffprobe output with and without a source file stat", async () => {
    scenarios.push(
      (proc) => {
        proc.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264" }] })),
        );
        proc.emit("close", 0);
      },
      (proc) => {
        proc.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ streams: [{ codec_type: "video", codec_name: "hevc" }] })),
        );
        proc.emit("close", 0);
      },
    );
    jest.spyOn(fs, "existsSync").mockReturnValueOnce(true).mockReturnValueOnce(false);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 99 } as fs.Stats);

    await expect(getOriginalVideoTechnicalData("present.mp4")).resolves.toMatchObject({
      codec: "h264",
      fileSizeBytes: 99,
    });
    await expect(getOriginalVideoTechnicalData("missing.mp4")).resolves.toEqual({ codec: "hevc" });
  });

  it("encodes an uncached video and verifies non-empty output", async () => {
    scenarios.push((proc) => proc.emit("close", 0));
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValueOnce(false).mockReturnValueOnce(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 10 } as fs.Stats);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(optimiseVideo("albums/trip/clip.mov", "public/data/albums")).resolves.toEqual({
      src: "/built/clip.mov@1920.mp4",
      mimeType: "video/mp4",
    });
    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/ffmpeg-test",
      expect.arrayContaining(["-i", "albums/trip/clip.mov", "-preset", "medium"]),
      { stdio: "pipe" },
    );
  });

  it("surfaces ffmpeg spawn and non-zero-exit failures", async () => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    scenarios.push(
      (proc) => proc.emit("error", new Error("spawn failed")),
      (proc) => {
        proc.stderr.emit("data", Buffer.from("bad codec"));
        proc.emit("close", 7);
      },
    );

    await expect(optimiseVideo("albums/trip/error.mov", "public/data/albums")).rejects.toThrow(
      "spawn failed",
    );
    await expect(optimiseVideo("albums/trip/exit.mov", "public/data/albums")).rejects.toThrow(
      "ffmpeg failed with code 7: bad codec",
    );
  });

  it.each([
    [false, 10],
    [true, 0],
  ])("rejects missing or empty ffmpeg output", async (exists, size) => {
    scenarios.push((proc) => proc.emit("close", 0));
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValueOnce(false).mockReturnValueOnce(exists);
    jest.spyOn(fs, "statSync").mockReturnValue({ size } as fs.Stats);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(optimiseVideo("albums/trip/empty.mov", "public/data/albums")).rejects.toThrow(
      "ffmpeg produced empty output",
    );
  });

  it("removes a corrupt production cache before re-encoding", async () => {
    process.env.NODE_ENV = "production";
    scenarios.push(
      (proc) => proc.emit("close", 1),
      (proc) => proc.emit("close", 0),
    );
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 10 } as fs.Stats);
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(optimiseVideo("albums/trip/corrupt.mov", "public/data/albums")).resolves.toEqual(
      expect.objectContaining({ mimeType: "video/mp4" }),
    );
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it("treats validation process errors as a corrupt cache", async () => {
    process.env.NODE_ENV = "production";
    scenarios.push(
      (proc) => proc.emit("error", new Error("validation failed")),
      (proc) => proc.emit("close", 0),
    );
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 10 } as fs.Stats);
    jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      optimiseVideo("albums/trip/validation-error.mov", "public/data/albums"),
    ).resolves.toEqual(expect.objectContaining({ mimeType: "video/mp4" }));
  });

  it("kills timed-out validation before re-encoding", async () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = "production";
    let validationProcess: FakeProcess | undefined;
    scenarios.push(
      (proc) => {
        validationProcess = proc;
      },
      (proc) => proc.emit("close", 0),
    );
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ size: 10 } as fs.Stats);
    jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const result = optimiseVideo("albums/trip/timeout.mov", "public/data/albums");
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(VIDEO_VALIDATION_TIMEOUT_MS);

    await expect(result).resolves.toEqual(expect.objectContaining({ mimeType: "video/mp4" }));
    expect(validationProcess?.kill).toHaveBeenCalledWith("SIGKILL");
    jest.useRealTimers();
  });
});
