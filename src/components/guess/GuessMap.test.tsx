/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { GuessMap } from "./GuessMap";

const mockFitBounds = jest.fn();
let mockCurrentMap: { fitBounds: typeof mockFitBounds } | null = { fitBounds: mockFitBounds };

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
    const path = [
      { lng: 179, lat: 10 },
      { lng: -179, lat: 12 },
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
