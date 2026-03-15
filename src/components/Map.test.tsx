import { render, screen } from "@testing-library/react";
import { MMap } from "./Map";

jest.mock("react-map-gl/maplibre", () => {
  const React = require("react");

  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="map">{children}</div>
    ),
    Marker: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="marker">{children}</div>
    ),
    useMap: () => ({
      current: {
        flyTo: jest.fn(),
      },
    }),
  };
});

describe("MMap", () => {
  it("renders the album map link as a relative app route", () => {
    render(<MMap coordinates={[35.6762, 139.6503]} />);

    expect(
      screen.getByRole("link", { name: "Album map" }).getAttribute("href"),
    ).toBe("/map?lat=35.6762&lon=139.650&zoom=14");
  });
});
