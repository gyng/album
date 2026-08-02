import { navigateTo, reloadCurrentPage } from "./navigate";

describe("navigation helpers", () => {
  const assign = jest.fn();
  const replace = jest.fn();
  const reload = jest.fn();

  const withLocation = (href: string) => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { assign, href, replace, reload } },
    });
  };

  beforeEach(() => {
    assign.mockClear();
    replace.mockClear();
    reload.mockClear();
    withLocation("https://photos.example/album/current");
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("navigates to the requested URL", () => {
    navigateTo("https://photos.example/album/next");

    expect(assign).toHaveBeenCalledWith("https://photos.example/album/next");
  });

  it("reloads without adding a history entry", () => {
    reloadCurrentPage();

    expect(reload).toHaveBeenCalled();
  });

  // Assigning the current href is a *fragment* navigation when the URL has one:
  // the browser scrolls and does not fetch. Album URLs carry a photo anchor, so
  // the "reload to continue" banner's button did nothing on exactly the pages
  // most likely to show it.
  it("still reloads when the URL carries a fragment", () => {
    withLocation("https://photos.example/album/current#DSCF2389.JPG");

    reloadCurrentPage();

    expect(reload).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
