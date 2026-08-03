/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { useNearViewport } from "./useNearViewport";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

const Probe = () => {
  const ref = React.useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return (
    <div ref={ref} data-testid="probe">
      {near ? "near" : "away"}
    </div>
  );
};

describe("useNearViewport", () => {
  let callback: Callback;
  let disconnect: jest.Mock;
  let observe: jest.Mock;

  beforeEach(() => {
    disconnect = jest.fn();
    observe = jest.fn();
    class FakeObserver {
      constructor(handler: Callback) {
        callback = handler;
      }
      observe = observe;
      disconnect = disconnect;
    }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
  });

  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it("starts away and turns on when the element comes near", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("away");

    act(() => callback([{ isIntersecting: true }]));

    expect(screen.getByTestId("probe")).toHaveTextContent("near");
  });

  // The reason this exists. A one-way gate would leave a live map behind for
  // every trip a reader scrolled past, and a browser hands out a limited number
  // of WebGL contexts before it starts dropping the oldest.
  it("turns off again when the element leaves", () => {
    render(<Probe />);
    act(() => callback([{ isIntersecting: true }]));
    act(() => callback([{ isIntersecting: false }]));

    expect(screen.getByTestId("probe")).toHaveTextContent("away");
  });

  it("stops observing when unmounted", () => {
    const { unmount } = render(<Probe />);
    unmount();

    expect(disconnect).toHaveBeenCalled();
  });

  it("renders the content where the browser cannot observe at all", () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;

    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("near");
  });
});
