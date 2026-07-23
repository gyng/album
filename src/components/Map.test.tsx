/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import DefaultMap, { MMap } from "./Map";

const flyTo = jest.fn();
const fitBounds = jest.fn();
let currentMap: { flyTo: typeof flyTo; fitBounds: typeof fitBounds } | null = {
  flyTo,
  fitBounds,
};
const mapProps = jest.fn();
const markerProps = jest.fn();

jest.mock("./map/adapters/maplibre", () => {
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: ReactNode }) => {
      mapProps(props);
      return <div data-testid="map">{children}</div>;
    },
    Marker: ({ children, ...props }: { children?: ReactNode }) => {
      markerProps(props);
      return <div data-testid="marker">{children}</div>;
    },
    useMap: () => ({ current: currentMap }),
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
    expect(flyTo).toHaveBeenCalledWith({ center: [139.6503, 35.6762], zoom: 12, speed: 2.4 });
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        projection: "mercator",
        attributionControl: { compact: true },
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
        mapStyle="satellite"
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
      expect.objectContaining({ longitude: 103, latitude: 1, style: { opacity: 0.5 } }),
    );
    expect(fitBounds).toHaveBeenCalledWith(
      [
        [103, 1],
        [104, 2],
      ],
      { padding: 48, maxZoom: 11, duration: 800 },
    );
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        mapStyle: expect.stringContaining("/satellite/style.json"),
        projection: { type: "vertical-perspective" },
        attributionControl: false,
        style: expect.objectContaining({ minHeight: 200 }),
      }),
    );
    expect(screen.queryByText("View on", { exact: false })).toBeNull();
  });

  it("uses a safe origin for an empty coordinate collection", () => {
    render(<MMap coordinates={[]} />);

    expect(screen.queryByTestId("marker")).toBeNull();
    expect(flyTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialViewState: { longitude: 0, latitude: 0, zoom: 12 } }),
    );
  });

  it("waits for the map instance before moving the camera", () => {
    currentMap = null;
    render(<MMap coordinates={[1, 103]} />);
    expect(flyTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });
});
