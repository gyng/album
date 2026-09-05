// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TrackPanel } from "./TrackPanel.tsx";
import type { GeotagPhoto } from "../api.ts";

vi.mock("../api.ts", async (original) => ({
  ...(await original<typeof import("../api.ts")>()),
  fetchTz: vi.fn().mockResolvedValue(null),
}));
afterEach(cleanup);

it("previews an override before applying any GPS assignments", async () => {
  const photo: GeotagPhoto = {
    filename: "wrong-offset.jpg",
    path: "/photos/wrong-offset.jpg",
    dateTimeOriginal: "2024-03-22T19:05:00",
    offsetTimeOriginal: "+00:00",
    decLat: null,
    decLng: null,
    gpsUtcMs: null,
    lensMake: null,
    lensModel: null,
    focalLength: null,
    focalLength35mm: null,
  };
  const onInterpolated = vi.fn();
  render(<TrackPanel photos={[photo]} onTrack={vi.fn()} onInterpolated={onInterpolated} />);
  const file = new File([], "track.gpx");
  Object.defineProperty(file, "text", {
    value: async () => `<gpx><trk><trkseg>
    <trkpt lat="35" lon="139"><time>2024-03-22T10:00:00Z</time></trkpt>
    <trkpt lat="35.2" lon="139.2"><time>2024-03-22T10:10:00Z</time></trkpt>
    </trkseg></trk></gpx>`,
  });
  fireEvent.change(screen.getByLabelText("Load GPX / Takeout…"), { target: { files: [file] } });
  await screen.findByRole("combobox", { name: "Offset source" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Interpolate album" }).hasAttribute("disabled")).toBe(
      true,
    ),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Offset source" }), {
    target: { value: "override" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Offset" }), {
    target: { value: "+09:00" },
  });
  expect(screen.getByRole("table", { name: "Track matches" }).textContent).toContain(
    "35.10000, 139.10000",
  );
  expect(onInterpolated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Interpolate album" }));
  expect(onInterpolated.mock.calls[0][0][photo.filename]).toMatchObject({ lat: 35.1, lng: 139.1 });
});
