/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Nav } from "./Nav";
import { AppLink } from "./platform";

jest.mock("./ThemeToggle", () => ({ ThemeToggle: () => <button type="button">Theme</button> }));

describe("Nav", () => {
  const scrollIntoView = jest.fn();
  const scrollTo = jest.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollLeft = options.left ?? this.scrollLeft;
  });
  const observe = jest.fn();
  const disconnect = jest.fn();
  let resize: (() => void) | undefined;

  beforeEach(() => {
    scrollIntoView.mockClear();
    scrollTo.mockClear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const x = this.matches("a[aria-current]") ? 150 : 0;
      const width = this.matches("a[aria-current]") ? 50 : 100;
      return {
        x,
        y: 0,
        left: x,
        right: x + width,
        top: 0,
        bottom: 44,
        width,
        height: 44,
        toJSON: () => ({}),
      };
    });
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
      "/map?filter_album=test+manifest",
    );
    expect(screen.getByRole("link", { name: "Album timeline" })).toHaveAttribute(
      "href",
      "/explore/timeline?filter_album=test+manifest",
    );
    expect(screen.getByRole("link", { name: "Album slideshow" })).toHaveAttribute(
      "href",
      "/slideshow/shell?filter=test+manifest",
    );
    expect(screen.getByText("Extra action")).toBeInTheDocument();
    expect(screen.getByRole("list").scrollLeft).toBe(100);
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

  it("scrolls the list sideways for a mouse wheel while it has room", () => {
    render(<Nav />);
    const list = screen.getByRole("list");
    Object.defineProperties(list, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });

    const turned = fireEvent.wheel(list, { deltaY: 60 });
    expect(list.scrollLeft).toBe(60);
    // The page does not scroll as well.
    expect(turned).toBe(false);

    list.scrollLeft = 200;
    expect(fireEvent.wheel(list, { deltaY: 60 })).toBe(true);
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

  it("offers a theme-adjacent picker inside the scrolling list as well as beside the theme", () => {
    // On a phone the pinned pair is wider than the nav row and takes a band of
    // its own; the copy inside the list is the one a narrow viewport shows.
    render(<Nav themeAdjacentItem={<select aria-label="Map style" />} />);

    const list = screen.getByRole("list");
    expect(within(list).getByRole("combobox", { name: "Map style" })).toBeInTheDocument();
  });

  it("reveals the current section when a subpage is selected", () => {
    render(
      <Nav
        extraItems={
          <li>
            <AppLink href="/explore" aria-current="true">
              Explore
            </AppLink>
          </li>
        }
      />,
    );
    expect(screen.getByRole("list").scrollLeft).toBe(100);
  });

  it("smoothly reveals the active link after a history restoration", async () => {
    render(<Nav isHome />);
    scrollTo.mockClear();
    screen.getByRole("list").scrollLeft = 0;
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("honours reduced-motion when revealing the current page", () => {
    jest.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<Nav isHome />);

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  });
});
