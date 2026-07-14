/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

jest.mock(
  "next/dynamic",
  () => (loader: () => Promise<unknown>, options: { loading: () => React.ReactNode }) => {
    Object.assign(globalThis, { __worldMapLoader: loader, __worldMapLoading: options.loading });
    return (props: { className: string; photos: unknown[] }) => (
      <div data-testid="deferred-world-map">
        {props.className}:{props.photos.length}
      </div>
    );
  },
);
jest.mock("./MapWorld", () => ({ MMap: () => null }));

import { MapWorldDeferred } from "./MapWorldDeferred";

describe("MapWorldDeferred", () => {
  it("passes world-map props through and exposes its loading state", async () => {
    const { __worldMapLoader: loadMap, __worldMapLoading: LoadingMap } =
      globalThis as typeof globalThis & {
        __worldMapLoader: () => Promise<unknown>;
        __worldMapLoading: () => React.ReactNode;
      };
    render(<MapWorldDeferred className="atlas" photos={[]} />);
    expect(screen.getByTestId("deferred-world-map")).toHaveTextContent("atlas:0");

    render(<>{LoadingMap()}</>);
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    await expect(loadMap()).resolves.toEqual(
      expect.objectContaining({ MMap: expect.any(Function) }),
    );
  });
});
