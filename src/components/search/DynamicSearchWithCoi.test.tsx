/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

jest.mock(
  "next/dynamic",
  () => (loader: () => Promise<unknown>, options: { loading: () => React.ReactNode }) => {
    Object.assign(globalThis, { __searchLoader: loader, __searchLoading: options.loading });
    return () => <div data-testid="dynamic-search" />;
  },
);
jest.mock("./SearchWithCoi", () => ({ __esModule: true, default: () => null }));

import DynamicSearchWithCoi from "./DynamicSearchWithCoi";

describe("DynamicSearchWithCoi", () => {
  it("loads the isolated search boundary and supplies fallback content", async () => {
    const { __searchLoader: loadSearch, __searchLoading: LoadingSearch } =
      globalThis as typeof globalThis & {
        __searchLoader: () => Promise<unknown>;
        __searchLoading: () => React.ReactNode;
      };
    render(<DynamicSearchWithCoi />);
    expect(screen.getByTestId("dynamic-search")).toBeInTheDocument();
    render(<>{LoadingSearch()}</>);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await expect(loadSearch()).resolves.toEqual(
      expect.objectContaining({ default: expect.any(Function) }),
    );
  });
});
