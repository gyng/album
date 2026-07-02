import { decidePoolReloadAction } from "./slideshowPoolReload";
import { RandomPhotoRow } from "../components/search/api";

const photo = (path: string): RandomPhotoRow => ({
  path,
  exif: "",
  geocode: "",
});

const pool = [photo("a"), photo("b"), photo("c")];

describe("decidePoolReloadAction", () => {
  it("advances in random mode", () => {
    expect(
      decidePoolReloadAction({
        mode: "random",
        hadCurrentPhoto: true,
        previousSeedPath: "a",
        pool,
      }),
    ).toEqual({ kind: "advance" });
  });

  it("advances in weighted mode", () => {
    expect(
      decidePoolReloadAction({
        mode: "weighted",
        hadCurrentPhoto: true,
        previousSeedPath: "a",
        pool,
      }),
    ).toEqual({ kind: "advance" });
  });

  it("advances in similar mode on a cold start (no photo was on screen)", () => {
    expect(
      decidePoolReloadAction({
        mode: "similar",
        hadCurrentPhoto: false,
        previousSeedPath: null,
        pool,
      }),
    ).toEqual({ kind: "advance" });
  });

  it("re-commits the surviving current photo on a similar-mode in-place refresh", () => {
    expect(
      decidePoolReloadAction({
        mode: "similar",
        hadCurrentPhoto: true,
        previousSeedPath: "b",
        pool,
      }),
    ).toEqual({ kind: "recommit", photo: photo("b") });
  });

  it("advances when the previous similar-mode seed no longer exists in the pool", () => {
    expect(
      decidePoolReloadAction({
        mode: "similar",
        hadCurrentPhoto: true,
        previousSeedPath: "gone",
        pool,
      }),
    ).toEqual({ kind: "advance" });
  });

  it("advances in similar mode when there is no previous seed path", () => {
    expect(
      decidePoolReloadAction({
        mode: "similar",
        hadCurrentPhoto: true,
        previousSeedPath: null,
        pool,
      }),
    ).toEqual({ kind: "advance" });
  });
});
