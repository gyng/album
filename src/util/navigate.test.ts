import { navigateTo, reloadCurrentPage } from "./navigate";

describe("navigation helpers", () => {
  const assign = jest.fn();
  const replace = jest.fn();

  beforeEach(() => {
    assign.mockClear();
    replace.mockClear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          assign,
          href: "https://photos.example/album/current",
          replace,
        },
      },
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("navigates to the requested URL", () => {
    navigateTo("https://photos.example/album/next");

    expect(assign).toHaveBeenCalledWith("https://photos.example/album/next");
  });

  it("reloads the exact current URL without adding history", () => {
    reloadCurrentPage();

    expect(replace).toHaveBeenCalledWith("https://photos.example/album/current");
  });
});
