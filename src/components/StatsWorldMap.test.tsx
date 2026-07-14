/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StatsWorldMap } from "./StatsWorldMap";

const mapProps = jest.fn();
const sourceProps = jest.fn();
const layerProps = jest.fn();
jest.mock("react-map-gl/maplibre", () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: ReactNode }) => {
    mapProps(props);
    return <div data-testid="stats-map">{children}</div>;
  },
  Source: ({ children, ...props }: { children?: ReactNode }) => {
    sourceProps(props);
    return <div data-testid="point-source">{children}</div>;
  },
  Layer: (props: { id: string }) => {
    layerProps(props);
    return <div data-testid="map-layer">{props.id}</div>;
  },
}));

describe("StatsWorldMap", () => {
  beforeEach(() => {
    mapProps.mockClear();
    sourceProps.mockClear();
    layerProps.mockClear();
  });

  it("converts latitude/longitude points into clustered GeoJSON", () => {
    const points = [
      { lat: 1.25, lng: 103.75 },
      { lat: -33.86, lng: 151.21 },
    ];
    const { rerender } = render(<StatsWorldMap points={points} />);

    expect(screen.getByTestId("stats-map")).toBeInTheDocument();
    expect(sourceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "stats-photo-points",
        type: "geojson",
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 42,
        data: {
          type: "FeatureCollection",
          features: [
            expect.objectContaining({ geometry: { type: "Point", coordinates: [103.75, 1.25] } }),
            expect.objectContaining({ geometry: { type: "Point", coordinates: [151.21, -33.86] } }),
          ],
        },
      }),
    );
    expect(screen.getAllByTestId("map-layer").map((node) => node.textContent)).toEqual([
      "stats-clusters",
      "stats-cluster-count",
      "stats-unclustered-point",
    ]);
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialViewState: { longitude: 15, latitude: 20, zoom: 1.25 },
        attributionControl: false,
      }),
    );

    rerender(<StatsWorldMap points={points} />);
    expect(sourceProps.mock.calls.at(-1)?.[0].data).toBe(sourceProps.mock.calls.at(-2)?.[0].data);
  });

  it("provides an empty feature collection when there are no mapped photos", () => {
    render(<StatsWorldMap points={[]} />);
    expect(sourceProps).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: "FeatureCollection", features: [] } }),
    );
  });
});
