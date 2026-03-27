import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  it("renders when localStorage access is unavailable", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });

    render(<ThemeToggle />);

    expect(screen.getByTitle(/toggle dark mode/i)).toBeTruthy();

    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("swallows localStorage write failures when toggling", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue("null");
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });

    render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle(/toggle dark mode/i));

    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
