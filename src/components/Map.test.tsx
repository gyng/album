/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import DefaultMap, { MMap } from "./Map";
import { mapStyleUrl } from "../util/mapStyles";

const flyTo = jest.fn();
const fitBounds = jest.fn();
let currentMap: { flyTo: typeof flyTo; fitBounds: typeof fitBounds } | null = {
  flyTo,
  fitBounds,
};
const mapProps = jest.fn();
const markerProps = jest.fn();

jest.mock("./map", () => {
  return {
    __esModule: true,
    MapView: ({ children, ...props }: { children?: ReactNode }) => {
      mapProps(props);
      return <div data-testid="map">{children}</div>;
    },
    Marker: ({ children, ...props }: { children?: ReactNode }) => {
      markerProps(props);
      return <div data-testid="marker">{children}</div>;
    },
    useMap: () => currentMap ?? undefined,
  };
});

jest.mock("./MapLibreStyles", () => ({
  MapLibreStyles: () => <link data-testid="maplibre-styles" />,
}));

describe("MMap", () => {
  beforeEach(() => {
    flyTo.mockClear();
    fitBounds.mockClear();
    mapProps.mockClear();
    markerProps.mockClear();
    currentMap = { flyTo, fitBounds };
  });

  it("renders the album map link as a relative app route", () => {
    render(<MMap coordinates={[35.6762, 139.6503]} />);

    expect(screen.getByTestId("maplibre-styles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Album map" }).getAttribute("href")).toBe(
      "/map?lat=35.6762&lon=139.650&zoom=14",
    );
    expect(flyTo).toHaveBeenCalledWith({
      center: { lng: 139.6503, lat: 35.6762 },
      zoom: 12,
      speed: 2.4,
    });
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        projection: "mercator",
        attribution: { compact: true },
      }),
    );
  });

  it("fits multiple markers and forwards visual map options", () => {
    render(
      <DefaultMap
        coordinates={[
          [1, 103],
          [2, 104],
        ]}
        mapStyle="dark"
        projection="vertical-perspective"
        attribution={false}
        details={false}
        style={{ minHeight: 200 }}
        markerStyle={{ opacity: 0.5 }}
      />,
    );

    expect(screen.getAllByTestId("marker")).toHaveLength(2);
    expect(markerProps).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        at: { lng: 103, lat: 1 },
        style: { color: "var(--c-accent)", opacity: 0.5 },
      }),
    );
    expect(fitBounds).toHaveBeenCalledWith(
      [
        { lng: 103, lat: 1 },
        { lng: 104, lat: 2 },
      ],
      { padding: 48, maxZoom: 11, duration: 800 },
    );
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        styleUrl: mapStyleUrl("dark"),
        projection: "vertical-perspective",
        attribution: false,
        style: expect.objectContaining({ minHeight: 200 }),
      }),
    );
    expect(screen.queryByText("View on", { exact: false })).toBeNull();
  });

  it("gives its location indicator a non-white default colour", () => {
    render(<MMap coordinates={[1, 103]} />);

    expect(markerProps).toHaveBeenCalledWith(
      expect.objectContaining({ style: { color: "var(--c-accent)" } }),
    );
  });

  it("uses a safe origin for an empty coordinate collection", () => {
    render(<MMap coordinates={[]} />);

    expect(screen.queryByTestId("marker")).toBeNull();
    expect(flyTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialView: { center: { lng: 0, lat: 0 }, zoom: 12 } }),
    );
  });

  it("waits for the map instance before moving the camera", () => {
    currentMap = null;
    render(<MMap coordinates={[1, 103]} />);
    expect(flyTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe("the basemap under a photograph", () => {
  // A theme with a map of its own is wearing it everywhere, not only on the map
  // page: a photograph shown under the terminal theme should not carry a street
  // map in the middle of a green screen.
  it("follows a theme that brings its own map", () => {
    document.documentElement.classList.add("theme-terminal");
    render(<DefaultMap coordinates={[[1, 103]]} />);

    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ styleUrl: mapStyleUrl("crt") }),
    );
    document.documentElement.classList.remove("theme-terminal");
  });

  it("keeps its own choice under the reading schemes", () => {
    render(<DefaultMap coordinates={[[1, 103]]} />);

    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ styleUrl: mapStyleUrl("streets") }),
    );
  });

  // A caller that names a style means it, whatever the page is wearing.
  it("obeys a style it was given", () => {
    document.documentElement.classList.add("theme-terminal");
    render(<DefaultMap coordinates={[[1, 103]]} mapStyle="dark" />);

    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ styleUrl: mapStyleUrl("dark") }),
    );
    document.documentElement.classList.remove("theme-terminal");
  });
});
