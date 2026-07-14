/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

const BrokenComponent = (): React.ReactNode => {
  throw new Error("Render failed");
};

describe("ErrorBoundary", () => {
  it("renders children while the component tree is healthy", () => {
    render(
      <ErrorBoundary>
        <main>Gallery content</main>
      </ErrorBoundary>,
    );

    expect(screen.getByRole("main")).toHaveTextContent("Gallery content");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces a failed tree with a recoverable alert", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(consoleError).toHaveBeenCalledWith(
      "Uncaught render error",
      expect.objectContaining({ message: "Render failed" }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(screen.getByRole("alert")).toBeTruthy();

    consoleError.mockRestore();
  });
});
