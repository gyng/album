/**
 * @jest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import type { MapWorldEntry } from "../util/pageDataTypes";
import { useMapThumbnailPrefetch } from "./useMapThumbnailPrefetch";

const photo = (src: string): Pick<MapWorldEntry, "src"> => ({
  src: { src, width: 10, height: 10 },
});

let requested: string[] = [];
const realImage = window.Image;

beforeEach(() => {
  requested = [];
  class RecordingImage {
    decoding = "";
    fetchPriority = "";
    addEventListener() {}
    set src(value: string) {
      requested.push(value);
    }
  }
  Object.defineProperty(window, "Image", { configurable: true, value: RecordingImage });
});

afterEach(() => {
  Object.defineProperty(window, "Image", { configurable: true, value: realImage });
});

it("fetches nothing until the map is near the reveal zoom", () => {
  renderHook(() => {
    useMapThumbnailPrefetch([photo("/a.jpg")], false);
  });
  expect(requested).toEqual([]);
});

it("fetches each photo once, so a pan does not re-request what is already warm", () => {
  const first = [photo("/a.jpg"), photo("/b.jpg")];
  const { rerender } = renderHook(
    ({ photos }) => {
      useMapThumbnailPrefetch(photos, true);
    },
    { initialProps: { photos: first } },
  );
  expect(requested).toEqual(["/a.jpg", "/b.jpg"]);

  // Panning hands over an overlapping set: only what is new should go out.
  rerender({ photos: [photo("/b.jpg"), photo("/c.jpg")] });
  expect(requested).toEqual(["/a.jpg", "/b.jpg", "/c.jpg"]);
});

it("caps a dense viewport so warming cannot flood the tile requests", () => {
  const photos = Array.from({ length: 5 }, (_, index) => photo(`/photo-${index}.jpg`));
  renderHook(() => {
    useMapThumbnailPrefetch(photos, true, 2);
  });
  expect(requested).toEqual(["/photo-0.jpg", "/photo-1.jpg"]);
});
