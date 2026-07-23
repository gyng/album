/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StatsWorldMap } from "./StatsWorldMap";

const mapProps = jest.fn();
const dataLayerProps = jest.fn();
jest.mock("./map", () => ({
  __esModule: true,
  MapView: ({ children, ...props }: { children?: ReactNode }) => {
    mapProps(props);
    return <div data-testid="stats-map">{children}</div>;
  },
  DataLayer: (props: { id: string }) => {
    dataLayerProps(props);
    return <div data-testid="data-layer">{props.id}</div>;
  },
}));

/** The props the mocked data layer was last rendered with. */
const lastDataLayerProps = () => dataLayerProps.mock.calls.at(-1)?.[0];

describe("StatsWorldMap", () => {
  beforeEach(() => {
    mapProps.mockClear();
    dataLayerProps.mockClear();
  });

  it("describes latitude/longitude points as clustered map features", () => {
    const points = [
      { lat: 1.25, lng: 103.75 },
      { lat: -33.86, lng: 151.21 },
    ];
    const { rerender } = render(<StatsWorldMap points={points} />);

    expect(screen.getByTestId("stats-map")).toBeInTheDocument();
    expect(dataLayerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "stats-photos",
        cluster: true,
        stroke: { color: "rgba(255, 255, 255, 0.84)", width: 2 },
        points: [
          expect.objectContaining({ at: { lng: 103.75, lat: 1.25 } }),
          expect.objectContaining({ at: { lng: 151.21, lat: -33.86 } }),
        ],
      }),
    );
    // Every photo is drawn the same way — the pink dot the stats page's accent
    // colour comes from.
    expect(lastDataLayerProps().points[0]).toEqual({
      id: expect.any(String),
      at: { lng: 103.75, lat: 1.25 },
      color: "rgb(230, 32, 101)",
      radius: 5,
    });
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialView: { center: { lng: 15, lat: 20 }, zoom: 1.25 },
        attribution: false,
      }),
    );

    rerender(<StatsWorldMap points={points} />);
    expect(dataLayerProps.mock.calls.at(-1)?.[0].points).toBe(
      dataLayerProps.mock.calls.at(-2)?.[0].points,
    );
  });

  it("provides no features when there are no mapped photos", () => {
    render(<StatsWorldMap points={[]} />);
    expect(lastDataLayerProps().points).toEqual([]);
  });
});
