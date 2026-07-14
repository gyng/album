/**
 * @jest-environment node
 */

import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary server rendering", () => {
  it("makes its reload action a safe no-op without a browser window", () => {
    const boundary = new ErrorBoundary({ children: null });

    expect(() => boundary.handleReload()).not.toThrow();
  });
});
