/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import type { RoutePoint } from "./mapRoute";
import type { ProjectedRouteSegment } from "./mapRouteOverlayModel";
import {
  projectGhostRoutePath,
  projectRouteSegments,
  selectPreferredLabelSegmentIds,
} from "./mapRouteOverlayModel";
import { MapRouteOverlay } from "./MapRouteOverlay";

let currentMap: any = null;
jest.mock("./map", () => ({ useMap: () => currentMap ?? undefined }));
jest.mock("./mapRouteOverlayModel", () => ({
  ...jest.requireActual("./mapRouteOverlayModel"),
  projectRouteSegments: jest.fn(),
  projectGhostRoutePath: jest.fn(),
  selectPreferredLabelSegmentIds: jest.fn(),
}));

const projectSegments = jest.mocked(projectRouteSegments);
const projectGhost = jest.mocked(projectGhostRoutePath);
const selectLabels = jest.mocked(selectPreferredLabelSegmentIds);

const point = (href: string, index: number): RoutePoint => ({
  album: "test-simple",
  src: { src: `/${href}.jpg`, width: 100, height: 80 },
  decLat: 1 + index,
  decLng: 103 + index,
  date: `2024-01-01T0${index}:00:00`,
  href,
  isStart: index === 0,
  isEnd: index === 2,
  sequenceIndex: index,
  stopPhotoCount: 1,
  memberHrefs: [href],
});

const segment = (
  id: string,
  overrides: Partial<ProjectedRouteSegment> = {},
): ProjectedRouteSegment => ({
  id,
  d: "M 1 2 L 3 4",
  color: "red",
  approxSpeedKmh: 30,
  durationSeconds: 3600,
  distanceKm: 6,
  midX: 2,
  midY: 3,
  startX: 1,
  startY: 2,
  endX: 3,
  endY: 4,
  angle: 10,
  lengthPx: 30,
  ...overrides,
});

const routePoints = [point("one", 0), point("two", 1), point("three", 2)];
const getPointColor = (_point: RoutePoint, index: number) => (index === 0 ? "red" : "blue");
const props = () => ({
  routePoints,
  routeMode: "full" as const,
  getPointColor,
  showSpeedLabels: true,
  ghostRoutePoints: routePoints,
});

describe("MapRouteOverlay", () => {
  const on = jest.fn();
  const project = jest.fn();
  const mapContainer = document.createElement("div");
  // The port hands back an unsubscribe rather than taking an `off` pair.
  const unsubscribed: string[] = [];
  const callbacks = new Map<string, () => void>();
  const segments = [
    segment("one-two", { distanceKm: 4 }),
    segment("two-three", {
      approxSpeedKmh: null,
      durationSeconds: 3 * 3600,
      distanceKm: 20,
      startX: 3,
      startY: 4,
      endX: 5,
      endY: 6,
    }),
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    unsubscribed.length = 0;
    callbacks.clear();
    on.mockImplementation((event: string, callback: () => void) => {
      callbacks.set(event, callback);
      return () => {
        unsubscribed.push(event);
      };
    });
    project.mockImplementation(({ lng, lat }: { lng: number; lat: number }) => ({
      x: lng,
      y: lat,
    }));
    Object.defineProperties(mapContainer, {
      clientWidth: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 80 },
    });
    currentMap = { on, project, getContainer: () => mapContainer, getZoom: () => 7 };
    projectSegments.mockImplementation((_points, projectPoint) => {
      projectPoint([1, 2]);
      return segments;
    });
    projectGhost.mockImplementation((_points, projectPoint) => {
      projectPoint([3, 4]);
      return "M 0 0 L 5 6";
    });
    selectLabels.mockReturnValue(new Set(["one-two", "two-three"]));
  });

  it("renders directional segments, labels, ghost route, and endpoints", () => {
    render(<MapRouteOverlay {...props()} />);

    expect(screen.getAllByTestId("journey-line-segment")).toHaveLength(2);
    expect(screen.getAllByTestId("journey-line-segment")[0]).toHaveClass(
      "routeOverlayPathAnimated",
    );
    expect(document.querySelectorAll(".routeEndpointPingAnimated")).toHaveLength(4);
    expect(screen.queryByTestId("journey-line-tracer")).toBeNull();
    expect(screen.getByTestId("journey-line-ghost-route")).toHaveStyle({
      strokeWidth: "2.5",
      strokeDasharray: "2 8",
    });
    expect(screen.getByTestId("journey-line-speed-label")).toHaveTextContent("30km/h · 4.0km");
    expect(screen.getByTestId("journey-line-start")).toHaveAttribute(
      "transform",
      "translate(1, 2)",
    );
    expect(screen.getByTestId("journey-line-end")).toHaveAttribute("transform", "translate(5, 6)");
    expect(document.querySelectorAll("linearGradient stop")).toHaveLength(3);
    expect(screen.getByTestId("journey-line-overlay")).toHaveAttribute("overflow", "hidden");
    expect(on.mock.calls.map(([event]) => event)).toEqual(["move", "zoom", "resize"]);
  });

  it("does not mount off-screen animated route legs", () => {
    projectSegments.mockReturnValue([
      segment("visible", { startX: 10, startY: 10, endX: 40, endY: 40 }),
      segment("offscreen", {
        startX: 1_000,
        startY: 1_000,
        endX: 1_100,
        endY: 1_100,
      }),
    ]);

    render(<MapRouteOverlay {...props()} />);

    expect(screen.getAllByTestId("journey-line-segment")).toHaveLength(1);
    expect(screen.getByTestId("journey-line-start")).toBeInTheDocument();
    expect(screen.queryByTestId("journey-line-end")).toBeNull();
  });

  it("keeps journey dashes static at the rich-thumbnail zoom", () => {
    currentMap = { ...currentMap, getZoom: () => 10 };

    render(<MapRouteOverlay {...props()} />);

    expect(screen.getAllByTestId("journey-line-segment")[0]).not.toHaveClass(
      "routeOverlayPathAnimated",
    );
    expect(document.querySelectorAll(".routeEndpointPingAnimated")).toHaveLength(0);
    const tracers = screen.getAllByTestId("journey-line-tracer");
    expect(tracers).toHaveLength(2);
    expect(tracers[0]?.querySelector("animateMotion")).toHaveAttribute("path", "M 1 2 L 3 4");
  });

  it("updates projection on map movement and unsubscribes on cleanup", () => {
    let frameCallback: FrameRequestCallback | null = null;
    const requestFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 1;
      });
    const view = render(<MapRouteOverlay {...props()} />);
    act(() => frameCallback?.(0));
    const callsAfterMount = projectSegments.mock.calls.length;
    act(() => callbacks.get("move")?.());
    act(() => frameCallback?.(1));
    expect(projectSegments.mock.calls.length).toBeGreaterThan(callsAfterMount);
    view.unmount();
    expect(unsubscribed).toEqual(["move", "zoom", "resize"]);
    requestFrame.mockRestore();
  });

  it("renders simplified transfer and local legs without optional annotations", () => {
    selectLabels.mockReturnValue(new Set(["two-three"]));
    const view = render(
      <MapRouteOverlay {...props()} routeMode="simplified" showSpeedLabels={false} />,
    );
    const [local, transfer] = screen.getAllByTestId("journey-line-segment");
    expect(local).toHaveStyle({ strokeWidth: "3.6", opacity: "0.82", strokeDasharray: "8 8" });
    expect(transfer).toHaveStyle({ strokeWidth: "4.8", opacity: "0.94", strokeDasharray: "18 10" });
    expect(screen.queryByTestId("journey-line-speed-label")).toBeNull();
    expect(screen.getByTestId("journey-line-ghost-route")).toHaveStyle({ strokeWidth: "3" });
    view.rerender(
      <MapRouteOverlay
        {...props()}
        routeMode="simplified"
        showSpeedLabels={false}
        ghostRoutePoints={null}
      />,
    );
    expect(screen.queryByTestId("journey-line-ghost-route")).toBeNull();
  });

  it("labels a long compact segment and skips segments outside label selection", () => {
    const far = segment("far", { distanceKm: 8, lengthPx: 10 });
    projectSegments.mockImplementation(() => [far]);
    selectLabels.mockReturnValue(new Set(["far"]));
    const view = render(<MapRouteOverlay {...props()} routePoints={[...routePoints]} />);
    expect(screen.getByTestId("journey-line-speed-label")).toHaveTextContent("8.0km");

    selectLabels.mockReturnValue(new Set());
    view.rerender(<MapRouteOverlay {...props()} routePoints={[...routePoints]} />);
    expect(screen.queryByTestId("journey-line-speed-label")).toBeNull();
  });

  it.each([
    [false, routePoints],
    [true, null],
    [true, [routePoints[0]]],
  ])("renders nothing without a projectable route", (hasMap, points) => {
    currentMap = hasMap
      ? { on, project, getContainer: () => mapContainer, getZoom: () => 7 }
      : null;
    projectSegments.mockReturnValue([]);
    const { container } = render(
      <MapRouteOverlay {...props()} routePoints={points as RoutePoint[] | null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("coalesces production map events into one animation frame and cancels it", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const frameCallbacks: FrameRequestCallback[] = [];
    const frame = jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return 11 + frameCallbacks.length;
    });
    const cancel = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const view = render(<MapRouteOverlay {...props()} />);
    callbacks.get("zoom")?.();
    expect(frame).toHaveBeenCalledTimes(1);
    act(() => frameCallbacks.shift()?.(0));
    callbacks.get("zoom")?.();
    expect(frame).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(12);
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });
});
