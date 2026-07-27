import type { Block } from "../services/types";
import { toVideoBlockEntry } from "./videoBlockEntry";

const videoBlock = (build: Record<string, unknown> | undefined, date?: string): Block =>
  ({
    kind: "video",
    id: "clip.mov",
    data: { type: "local", href: "/clip@1920.mp4", ...(date ? { date } : {}) },
    ...(build ? { _build: build } : {}),
  }) as Block;

const poster = { srcset: [{ src: "/clip.mov@800.avif", width: 800, height: 450 }] };

describe("toVideoBlockEntry", () => {
  it("reads a prepared clip's frame, moment and place", () => {
    const entry = toVideoBlockEntry(
      videoBlock({
        src: "/clip@1920.mp4",
        mimeType: "video/mp4",
        poster,
        capturedAtLocal: "2026-02-27T10:52:10",
        latDeg: 35.6895,
        lngDeg: 139.6917,
        durationSeconds: 13.013,
      }),
    );

    expect(entry).toMatchObject({
      anchor: "clip.mov",
      capturedAtLocal: "2026-02-27T10:52:10",
      decLat: 35.6895,
      decLng: 139.6917,
      durationSeconds: 13.013,
      poster: { src: "/clip.mov@800.avif", width: 800, height: 450 },
    });
  });

  // Until the poster prepass has run there is no frame to draw, so the clip is
  // left off the map and the timeline rather than rendered as a hole in a grid.
  it("returns nothing for a clip with no extracted poster", () => {
    expect(
      toVideoBlockEntry(
        videoBlock({
          src: "/clip@1920.mp4",
          mimeType: "video/mp4",
          capturedAtLocal: "2026-02-27T10:52:10",
        }),
      ),
    ).toBeNull();
    expect(toVideoBlockEntry(videoBlock(undefined))).toBeNull();
  });

  // An undated clip has no place in a timeline and no ordering against photos.
  it("returns nothing for a clip with no time", () => {
    expect(
      toVideoBlockEntry(videoBlock({ src: "/clip@1920.mp4", mimeType: "video/mp4", poster })),
    ).toBeNull();
  });

  // A manifest date is the author's own answer and stands in for a container
  // timestamp the file never carried.
  it("falls back to the date declared in the manifest", () => {
    const entry = toVideoBlockEntry(
      videoBlock({ src: "/clip@1920.mp4", mimeType: "video/mp4", poster }, "2019-11-07T00:00:00"),
    );

    expect(entry?.capturedAtLocal).toBe("2019-11-07T00:00:00");
    expect(entry?.decLat).toBeNull();
  });

  it("ignores blocks that are not videos", () => {
    expect(toVideoBlockEntry({ kind: "text", id: "t", data: {} } as Block)).toBeNull();
  });
});
