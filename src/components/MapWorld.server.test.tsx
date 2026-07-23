/**
 * @jest-environment node
 */

import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";

jest.mock("./map/adapters/maplibre", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ScaleControl: () => null,
  NavigationControl: () => null,
  GeolocateControl: () => null,
  FullscreenControl: () => null,
  Source: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Layer: () => null,
  useMap: () => ({ current: null }),
}));

jest.mock("./ThemeToggle", () => ({ ThemeToggle: () => null }));
jest.mock("./MapWorldMapChildren", () => ({
  MapAutoFit: () => null,
  MapFitOnRequest: () => null,
  MapBoundsTracker: () => null,
  MapMiddleDragOrbit: () => null,
}));
jest.mock("./MapRouteOverlay", () => ({ MapRouteOverlay: () => null }));
jest.mock("./MapPhotoPopup", () => ({ MapPhotoPopup: () => null }));
jest.mock("./MapPhotoMarkers", () => ({ MapPhotoMarkers: () => null }));
jest.mock("./MapContextMenu", () => ({ MapContextMenu: () => null }));
jest.mock("./MapDirector", () => ({ MapDirector: () => null }));
jest.mock("./MapRecencyLegend", () => ({ MapRecencyLegend: () => null }));

import { MMap } from "./MapWorld";

describe("MapWorld server rendering", () => {
  it("renders without browser URL state", () => {
    expect(renderToString(<MMap photos={[]} className="map" />)).toContain('class="map"');
  });
});
