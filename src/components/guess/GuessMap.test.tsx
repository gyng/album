/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { GuessMap } from "./GuessMap";

const mockFitBounds = jest.fn();
const mockGetCenter = jest.fn(() => ({ lng: -0.12, lat: 51.5 }));
type MockMap = { fitBounds: typeof mockFitBounds; getCenter: typeof mockGetCenter };
let mockCurrentMap: MockMap | null = { fitBounds: mockFitBounds, getCenter: mockGetCenter };

jest.mock("../map", () => ({
  __esModule: true,
  MapView: ({
    children,
    cursor,
    onClick,
  }: React.PropsWithChildren<{ cursor: string; onClick: (event: unknown) => void }>) => (
    <button
      type="button"
      aria-label="Map surface"
      data-cursor={cursor}
      onClick={() => onClick({ type: "click", at: { lat: 1.25, lng: 103.75 } })}
    >
      {children}
    </button>
  ),
  Marker: ({ children, at }: React.PropsWithChildren<{ at: { lat: number; lng: number } }>) => (
    <div data-testid="marker" data-position={`${at.lat},${at.lng}`}>
      {children}
    </div>
  ),
  DataLayer: ({ id, lines }: { id: string; lines?: unknown }) => (
    <div data-testid={id} data-lines={JSON.stringify(lines)} />
  ),
  useMap: () => mockCurrentMap ?? undefined,
}));

/** The line features the guess-to-answer layer was handed. */
const renderedLines = () =>
  JSON.parse(screen.getByTestId("guess-line").getAttribute("data-lines") ?? "null");

describe("GuessMap", () => {
  beforeEach(() => {
    mockFitBounds.mockClear();
    mockCurrentMap = { fitBounds: mockFitBounds, getCenter: mockGetCenter };
  });

  it("prompts for a guess and forwards map coordinates", () => {
    const onGuess = jest.fn();
    render(<GuessMap guess={null} onGuess={onGuess} />);

    expect(screen.getByText("Place your guess on the map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map surface" })).toHaveAttribute(
      "data-cursor",
      "crosshair",
    );

    fireEvent.click(screen.getByRole("button", { name: "Map surface" }));
    expect(onGuess).toHaveBeenCalledWith(1.25, 103.75);
  });

  it("places a guess at the map centre from the keyboard", () => {
    const onGuess = jest.fn();
    const { rerender } = render(<GuessMap guess={null} onGuess={onGuess} />);

    fireEvent.click(screen.getByRole("button", { name: "Guess at map centre" }));
    expect(onGuess).toHaveBeenCalledWith(51.5, -0.12);

    rerender(<GuessMap guess={null} reveal={{ lat: 1, lng: 2 }} onGuess={onGuess} />);
    expect(screen.queryByRole("button", { name: "Guess at map centre" })).not.toBeInTheDocument();
  });

  it("shows a guess marker before reveal", () => {
    render(<GuessMap guess={{ lat: 35, lng: 139 }} onGuess={jest.fn()} />);

    expect(screen.getByTestId("marker")).toHaveAttribute("data-position", "35,139");
    expect(screen.queryByText("Place your guess on the map")).not.toBeInTheDocument();
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
        { lng: 151.2, lat: -33.9 },
        { lng: 151.2, lat: -33.9 },
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
    // Unwrapped past 180° so the line takes the 2° hop, not the 358° one.
    const path = [
      { lng: 179, lat: 10 },
      { lng: 181, lat: 12 },
    ];
    // A wide soft glow underneath, the dashed line over it.
    expect(renderedLines()).toEqual([
      expect.objectContaining({ path, width: 6, opacity: 0.2, blur: 4 }),
      expect.objectContaining({ path, width: 2, dash: [4, 3] }),
    ]);
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
