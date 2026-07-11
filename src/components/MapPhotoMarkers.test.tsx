/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PhotoWithStyle } from "./mapWorldViewModel";
import { MapPhotoMarkers } from "./MapPhotoMarkers";

const stopPropagation = jest.fn();
jest.mock("react-map-gl/maplibre", () => ({
  Marker: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: (event: { originalEvent: { stopPropagation: () => void } }) => void;
  }) => (
    <button
      type="button"
      aria-label="Map marker"
      data-testid="marker"
      onClick={() => {
        onClick?.({ originalEvent: { stopPropagation } });
      }}
    >
      {children}
    </button>
  ),
}));

jest.mock("./MapWorldMapChildren", () => ({
  LazyMapMarkerImage: () => <div data-testid="marker-image" />,
}));

const photo = (overrides: Partial<PhotoWithStyle> = {}): PhotoWithStyle => ({
  album: "kansai",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 35.6762,
  decLng: 139.6503,
  date: "2024-01-02T03:04:05",
  href: "/album/kansai#photo.jpg",
  relative: 0.5,
  markerColor: "red",
  ...overrides,
});

describe("MapPhotoMarkers", () => {
  beforeEach(() => {
    stopPropagation.mockClear();
  });

  it("supports pointer, focus, and keyboard selection", () => {
    const onSelect = jest.fn();
    const onHover = jest.fn();
    const currentPhoto = photo();

    render(
      <MapPhotoMarkers
        photos={[currentPhoto]}
        zoom={9}
        emphasiseRoute={false}
        activeRouteHrefSet={new Set()}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );

    const control = screen.getByRole("button", { name: "Photo from kansai on 2 Jan 2024" });
    fireEvent.mouseOver(control);
    fireEvent.mouseLeave(control);
    fireEvent.focus(control);
    fireEvent.keyDown(control, { key: "Enter" });
    fireEvent.click(screen.getByTestId("marker"));

    expect(onHover.mock.calls).toEqual([[currentPhoto], [null], [currentPhoto]]);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("marker-image")).toBeTruthy();
  });

  it("marks route members active and other photos muted", () => {
    render(
      <MapPhotoMarkers
        photos={[photo({ href: "active" }), photo({ href: "inactive", decLng: 140 })]}
        zoom={8}
        emphasiseRoute
        activeRouteHrefSet={new Set(["active"])}
        onSelect={jest.fn()}
        onHover={jest.fn()}
      />,
    );

    const controls = screen.getAllByRole("button", { name: /Photo from kansai/ });
    expect(controls[0]?.className).toContain("pinActive");
    expect(controls[1]?.className).toContain("pinMuted");
    expect(screen.queryByTestId("marker-image")).toBeNull();
  });

  it("omits photos without complete coordinates", () => {
    render(
      <MapPhotoMarkers
        photos={[photo({ decLat: null }), photo({ href: "valid" })]}
        zoom={null}
        emphasiseRoute={false}
        activeRouteHrefSet={new Set()}
        onSelect={jest.fn()}
        onHover={jest.fn()}
      />,
    );

    expect(screen.getAllByTestId("marker")).toHaveLength(1);
  });
});
