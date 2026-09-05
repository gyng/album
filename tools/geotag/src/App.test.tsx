// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { listFolder, writeGps, writeLens, type FolderListing } from "./api.ts";

vi.mock("./api.ts", async (original) => ({
  ...(await original<typeof import("./api.ts")>()),
  listFolder: vi.fn(),
  writeGps: vi.fn(),
  writeLens: vi.fn(),
}));
vi.mock("./components/GeotagMap.tsx", () => ({
  GeotagMap: ({ track }: { track: { points: unknown[] } | null }) => (
    <output aria-label="Loaded track">{track?.points.length ?? 0}</output>
  ),
}));

const folder = (path: string): FolderListing => ({
  path,
  parent: "/photos",
  subdirs: [{ name: "child", imageCount: 1 }],
  photos: [
    {
      filename: "same.jpg",
      path: `${path}/same.jpg`,
      dateTimeOriginal: null,
      offsetTimeOriginal: null,
      decLat: null,
      decLng: null,
      gpsUtcMs: null,
      lensMake: null,
      lensModel: null,
      focalLength: null,
      focalLength35mm: null,
    },
  ],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const assign = (coordinates: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: "Coordinates" }), {
    target: { value: coordinates },
  });
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
};
beforeEach(() => {
  vi.resetAllMocks();
  // Node 26 also exposes localStorage; Vitest can pick that unavailable
  // host getter over jsdom's. Storage is an external boundary in these tests.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(listFolder).mockResolvedValue(folder("/photos/a"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preserves a revised GPS draft while the submitted assignment finishes", async () => {
  const response = deferred<Awaited<ReturnType<typeof writeGps>>>();
  vi.mocked(writeGps).mockReturnValue(response.promise);
  render(<App />);
  fireEvent.click(await screen.findByRole("checkbox"));
  assign("1, 2");
  fireEvent.click(screen.getByRole("button", { name: "Write 1 location" }));
  assign("3, 4");
  await act(async () =>
    response.resolve([
      { filename: "same.jpg", path: "/photos/a/same.jpg", ok: true, lat: 1, lng: 2 },
    ]),
  );
  expect(screen.getByRole("checkbox").textContent).toContain("3.00000, 4.00000");
  expect(screen.getByRole("button", { name: "Write 1 location" }).hasAttribute("disabled")).toBe(
    false,
  );
});

it("does not clear another folder's draft or reload the old folder after a write", async () => {
  const response = deferred<Awaited<ReturnType<typeof writeGps>>>();
  vi.mocked(writeGps).mockReturnValue(response.promise);
  render(<App />);
  fireEvent.click(await screen.findByRole("checkbox"));
  assign("1, 2");
  fireEvent.click(screen.getByRole("button", { name: "Write 1 location" }));
  vi.mocked(listFolder).mockResolvedValue(folder("/photos/b"));
  fireEvent.click(screen.getByRole("button", { name: /child/ }));
  await screen.findByDisplayValue("/photos/b");
  fireEvent.click(await screen.findByRole("checkbox"));
  assign("3, 4");
  const requests = vi.mocked(listFolder).mock.calls.length;
  await act(async () =>
    response.resolve([
      { filename: "same.jpg", path: "/photos/a/same.jpg", ok: true, lat: 1, lng: 2 },
    ]),
  );
  expect(screen.getByRole("checkbox").textContent).toContain("3.00000, 4.00000");
  expect(listFolder).toHaveBeenCalledTimes(requests);
  expect(screen.getByDisplayValue("/photos/b")).toBeTruthy();
});

it("ignores an older folder response after a newer navigation finishes", async () => {
  render(<App />);
  await screen.findByRole("checkbox");
  const older = deferred<FolderListing>();
  vi.mocked(listFolder)
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce(folder("/photos/new"));
  fireEvent.click(screen.getByRole("button", { name: /child/ }));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByDisplayValue("/photos/new");
  await act(async () => older.resolve(folder("/photos/old")));
  expect(screen.getByDisplayValue("/photos/new")).toBeTruthy();
});

it("does not attach an old folder's pending track load to the next folder", async () => {
  render(<App />);
  await screen.findByRole("checkbox");
  const text = deferred<string>();
  const nextFolder = deferred<FolderListing>();
  const file = new File([], "track.gpx");
  Object.defineProperty(file, "text", { value: () => text.promise });
  fireEvent.change(screen.getByLabelText("Load GPX / Takeout…"), { target: { files: [file] } });
  vi.mocked(listFolder).mockReturnValue(nextFolder.promise);
  fireEvent.click(screen.getByRole("button", { name: /child/ }));
  await act(async () => {
    text.resolve(
      '<gpx><trk><trkseg><trkpt lat="35" lon="139"><time>2024-03-22T10:00:00Z</time></trkpt></trkseg></trk></gpx>',
    );
  });
  await act(async () => nextFolder.resolve(folder("/photos/b")));
  expect(screen.getByLabelText("Loaded track").textContent).toBe("0");
});

it("preserves a revised lens assignment while an earlier lens write finishes", async () => {
  const first = {
    id: "first",
    name: "First",
    make: "",
    model: "First lens",
    focalLength: null,
    focalLength35mm: null,
  };
  const second = { ...first, id: "second", name: "Second", model: "Second lens" };
  window.localStorage.setItem("geotag.manual-lens-presets.v1", JSON.stringify([first, second]));
  const response = deferred<Awaited<ReturnType<typeof writeLens>>>();
  vi.mocked(writeLens).mockReturnValue(response.promise);
  render(<App />);
  await screen.findByRole("checkbox");
  fireEvent.click(screen.getByRole("button", { name: /Manual lens/ }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getAllByRole("button", { name: "Apply to 1" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Write 1 lens tag" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Apply to 1" })[1]);
  await act(async () =>
    response.resolve([{ filename: "same.jpg", path: "/photos/a/same.jpg", lens: first, ok: true }]),
  );
  await waitFor(() => expect(screen.getByRole("checkbox").textContent).toContain("Second lens"));
});
