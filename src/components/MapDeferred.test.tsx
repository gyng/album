/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

jest.mock(
  "next/dynamic",
  () => (loader: () => Promise<unknown>, options: { loading: () => React.ReactNode }) => {
    Object.assign(globalThis, {
      __mapDeferredLoader: loader,
      __mapDeferredLoading: options.loading,
    });
    return (props: { coordinates: [number, number] }) => (
      <div data-testid="deferred-map">{props.coordinates.join(",")}</div>
    );
  },
);
jest.mock("./Map", () => ({ MMap: () => null }));

import { MapDeferred } from "./MapDeferred";

describe("MapDeferred", () => {
  it("passes map props through and provides an accessible loading state", async () => {
    const { __mapDeferredLoader: loadMap, __mapDeferredLoading: LoadingMap } =
      globalThis as typeof globalThis & {
        __mapDeferredLoader: () => Promise<unknown>;
        __mapDeferredLoading: () => React.ReactNode;
      };
    render(<MapDeferred coordinates={[1.25, 103.75]} />);
    expect(screen.getByTestId("deferred-map")).toHaveTextContent("1.25,103.75");

    const loading = render(<>{LoadingMap()}</>);
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    loading.unmount();
    await expect(loadMap()).resolves.toEqual(
      expect.objectContaining({ MMap: expect.any(Function) }),
    );
  });
});
