/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Nav } from "./Nav";

jest.mock("./ThemeToggle", () => ({ ThemeToggle: () => <button type="button">Theme</button> }));

describe("Nav", () => {
  const scrollIntoView = jest.fn();
  const observe = jest.fn();
  const disconnect = jest.fn();
  let resize: (() => void) | undefined;

  beforeEach(() => {
    scrollIntoView.mockClear();
    observe.mockClear();
    disconnect.mockClear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: jest.fn((callback: () => void) => {
        resize = callback;
        return { observe, disconnect };
      }),
    });
    jest.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
  });

  afterEach(() => jest.restoreAllMocks());

  it("renders album destinations and brings the active destination into view", () => {
    const view = render(
      <Nav
        albumName="test manifest"
        hasPadding={false}
        isHome
        extraItems={<li>Extra action</li>}
      />,
    );

    expect(screen.getByRole("link", { name: "Albums" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Album map" })).toHaveAttribute(
      "href",
      "/map?filter_album=test manifest",
    );
    expect(screen.getByRole("link", { name: "Album timeline" })).toHaveAttribute(
      "href",
      "/timeline?filter_album=test manifest",
    );
    expect(screen.getByRole("link", { name: "Album slideshow" })).toHaveAttribute(
      "href",
      "/slideshow?filter=test manifest",
    );
    expect(screen.getByText("Extra action")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    });
    expect(observe).toHaveBeenCalledWith(screen.getByRole("list"));

    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("updates edge affordances as the horizontal list scrolls", () => {
    const { container } = render(<Nav />);
    const list = screen.getByRole("list");
    Object.defineProperties(list, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });

    act(() => resize?.());
    expect(container.querySelector("nav")?.className).toContain("scrollableRight");
    expect(container.querySelector("nav")?.className).not.toContain("scrollableLeft");

    list.scrollLeft = 200;
    fireEvent.scroll(list);
    expect(container.querySelector("nav")?.className).toContain("scrollableLeft");
    expect(container.querySelector("nav")?.className).not.toContain("scrollableRight");
  });

  it("moves keyboard focus to main content from the skip link", () => {
    const main = document.createElement("main");
    document.body.append(main);
    render(<Nav />);

    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));

    expect(main).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(main);
    expect(scrollIntoView).toHaveBeenCalledWith();
    main.remove();
  });

  it("does not intercept the skip link when the page has no main content", () => {
    render(<Nav />);
    const skip = screen.getByRole("link", { name: "Skip to content" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    skip.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("honours reduced-motion when revealing the current page", () => {
    jest.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<Nav isHome />);

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
