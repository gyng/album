/**
 * @jest-environment jsdom
 */

import { act, render } from "@testing-library/react";
import { depthSortKey, isPitched, PITCH_ORDERING_THRESHOLD, useMarkerDepth } from "./mapDepth";

describe("isPitched", () => {
  // Flat, the map has no depth, and pins are ordered by whatever the map is
  // about — recency on the world map. Depth ordering there would be noise.
  it("only treats a genuinely tilted camera as pitched", () => {
    expect(isPitched(0)).toBe(false);
    expect(isPitched(PITCH_ORDERING_THRESHOLD - 1)).toBe(false);
    expect(isPitched(PITCH_ORDERING_THRESHOLD)).toBe(true);
    expect(isPitched(60)).toBe(true);
  });
});

describe("depthSortKey", () => {
  // Further down the screen is nearer the camera on a tilted map, so it draws
  // on top.
  it("puts what is lower on the screen in front", () => {
    expect(depthSortKey(400)).toBeGreaterThan(depthSortKey(120));
  });

  it("keeps a point above the horizon out of negative z-index", () => {
    expect(depthSortKey(-80)).toBe(0);
  });
});

describe("useMarkerDepth", () => {
  const makeMap = (pitch: number, project: (at: { lng: number; lat: number }) => { y: number }) => {
    const handlers: Record<string, () => void> = {};
    return {
      map: {
        getPitch: () => pitch,
        project: (at: { lng: number; lat: number }) => ({ x: 0, ...project(at) }),
        on: (event: string, handler: () => void) => {
          handlers[event] = handler;
          return () => delete handlers[event];
        },
      },
      fire: (event: string) => handlers[event]?.(),
    };
  };

  const Probe = ({ map }: { map: unknown }) => {
    const { pitched, keyFor } = useMarkerDepth(map as never);
    return (
      <span data-testid="probe">
        {String(pitched)}:{String(keyFor({ lng: 0, lat: 0 }))}
      </span>
    );
  };

  it("gives no key at all while the map is flat", () => {
    const { map } = makeMap(0, () => ({ y: 300 }));
    const { getByTestId } = render(<Probe map={map} />);

    expect(getByTestId("probe")).toHaveTextContent("false:null");
  });

  it("orders by screen depth once the camera is tilted", () => {
    const { map } = makeMap(45, () => ({ y: 300 }));
    const { getByTestId } = render(<Probe map={map} />);

    expect(getByTestId("probe")).toHaveTextContent("true:300");
  });

  // A pan or a rotation moves every pin without changing the pitch, so the
  // projection has to be read again when the camera settles.
  it("re-reads the projection when the camera settles", () => {
    let y = 100;
    const { map, fire } = makeMap(45, () => ({ y }));
    const { getByTestId } = render(<Probe map={map} />);
    expect(getByTestId("probe")).toHaveTextContent("true:100");

    y = 250;
    act(() => fire("moveend"));

    expect(getByTestId("probe")).toHaveTextContent("true:250");
  });

  it("does nothing without a map", () => {
    const { getByTestId } = render(<Probe map={null} />);

    expect(getByTestId("probe")).toHaveTextContent("false:null");
  });
});
