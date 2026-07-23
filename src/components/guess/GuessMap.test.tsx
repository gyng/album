/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { GuessMap } from "./GuessMap";

const mockFitBounds = jest.fn();
let mockCurrentMap: { fitBounds: typeof mockFitBounds } | null = { fitBounds: mockFitBounds };

jest.mock("../map/adapters/maplibre", () => ({
  __esModule: true,
  default: ({
    children,
    cursor,
    onClick,
  }: React.PropsWithChildren<{ cursor: string; onClick: (event: unknown) => void }>) => (
    <button
      type="button"
      aria-label="Map surface"
      data-cursor={cursor}
      onClick={() => onClick({ lngLat: { lat: 1.25, lng: 103.75 } })}
    >
      {children}
    </button>
  ),
  Marker: ({
    children,
    latitude,
    longitude,
  }: React.PropsWithChildren<{ latitude: number; longitude: number }>) => (
    <div data-testid="marker" data-position={`${latitude},${longitude}`}>
      {children}
    </div>
  ),
  Source: ({ children, data }: React.PropsWithChildren<{ data: unknown }>) => (
    <div data-testid="line-source" data-geojson={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Layer: ({ id }: { id: string }) => <div data-testid={id} />,
  useMap: () => ({ current: mockCurrentMap }),
}));

describe("GuessMap", () => {
  beforeEach(() => {
    mockFitBounds.mockClear();
    mockCurrentMap = { fitBounds: mockFitBounds };
  });

  it("prompts for a guess and forwards map coordinates", () => {
    const onGuess = jest.fn();
    render(<GuessMap guess={null} onGuess={onGuess} />);

    expect(screen.getByText("Click to place your guess")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map surface" })).toHaveAttribute(
      "data-cursor",
      "crosshair",
    );

    fireEvent.click(screen.getByRole("button", { name: "Map surface" }));
    expect(onGuess).toHaveBeenCalledWith(1.25, 103.75);
  });

  it("shows a guess marker before reveal", () => {
    render(<GuessMap guess={{ lat: 35, lng: 139 }} onGuess={jest.fn()} />);

    expect(screen.getByTestId("marker")).toHaveAttribute("data-position", "35,139");
    expect(screen.queryByText("Click to place your guess")).not.toBeInTheDocument();
  });

  it("frames a skipped answer and prevents further guesses", () => {
    const onGuess = jest.fn();
    render(<GuessMap guess={null} reveal={{ lat: -33.9, lng: 151.2 }} onGuess={onGuess} />);

    expect(screen.getByRole("button", { name: "Map surface" })).toHaveAttribute(
      "data-cursor",
      "default",
    );
    expect(screen.getByTestId("marker")).toHaveAttribute("data-position", "-33.9,151.2");
    expect(mockFitBounds).toHaveBeenCalledWith(
      [
        [151.2, -33.9],
        [151.2, -33.9],
      ],
      { padding: 60, maxZoom: 6, duration: 800 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Map surface" }));
    expect(onGuess).not.toHaveBeenCalled();
  });

  it("draws and frames the shortest connection from guess to answer", () => {
    const { rerender } = render(
      <GuessMap
        guess={{ lat: 10, lng: 179 }}
        reveal={{ lat: 12, lng: -179 }}
        onGuess={jest.fn()}
      />,
    );

    expect(screen.getAllByTestId("marker")).toHaveLength(2);
    const data = JSON.parse(screen.getByTestId("line-source").getAttribute("data-geojson") ?? "");
    expect(data.features[0].geometry.coordinates).toEqual([
      [179, 10],
      [-179, 12],
    ]);
    expect(screen.getByTestId("guess-line-glow")).toBeInTheDocument();
    expect(screen.getByTestId("guess-line-layer")).toBeInTheDocument();
    expect(mockFitBounds).toHaveBeenCalledTimes(1);

    rerender(
      <GuessMap
        guess={{ lat: 10, lng: 179 }}
        reveal={{ lat: 12, lng: -179 }}
        onGuess={jest.fn()}
      />,
    );
    expect(mockFitBounds).toHaveBeenCalledTimes(1);

    rerender(
      <GuessMap
        guess={{ lat: 11, lng: 178 }}
        reveal={{ lat: 12, lng: -179 }}
        onGuess={jest.fn()}
      />,
    );
    expect(mockFitBounds).toHaveBeenCalledTimes(2);
  });

  it("does not attempt to frame before the map instance is ready", () => {
    mockCurrentMap = null;

    render(<GuessMap guess={null} reveal={{ lat: 1, lng: 2 }} onGuess={jest.fn()} />);

    expect(mockFitBounds).not.toHaveBeenCalled();
  });
});
