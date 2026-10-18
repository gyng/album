/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import { GameDock } from "./GameDock";

const layout = ({ bottomInset }: { bottomInset: string }) => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
  jest
    .spyOn(window, "matchMedia")
    .mockImplementation(
      (query) => ({ matches: query.includes("max-width"), media: query }) as MediaQueryList,
    );
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ height: 200 } as DOMRect);
  const computed = window.getComputedStyle;
  jest.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computed(element);
    return new Proxy(style, {
      get: (target, property) =>
        property === "insetBlockStart"
          ? "8px"
          : property === "scrollPaddingBlockEnd"
            ? bottomInset
            : Reflect.get(target, property),
    });
  });
};

afterEach(() => jest.restoreAllMocks());

// 400px viewport, 200px dock, 8px top clearance: 192px remain, enough for the 144px minimum.
it("docks when the space below it is usable", () => {
  layout({ bottomInset: "0px" });
  const report = jest.fn();
  render(
    <GameDock label="Clues" onStickyHeightChange={report}>
      Clues
    </GameDock>,
  );
  expect(report).toHaveBeenLastCalledWith(200);
});

it("counts the bottom safe area against the space left below the dock", () => {
  layout({ bottomInset: "60px" });
  const report = jest.fn();
  render(
    <GameDock label="Clues" onStickyHeightChange={report}>
      Clues
    </GameDock>,
  );
  expect(report).toHaveBeenLastCalledWith(0);
});

it("releases its reserved height when it unmounts", () => {
  layout({ bottomInset: "0px" });
  const report = jest.fn();
  const view = render(
    <GameDock label="Clues" onStickyHeightChange={report}>
      Clues
    </GameDock>,
  );
  expect(report).toHaveBeenLastCalledWith(200);
  view.unmount();
  expect(report).toHaveBeenLastCalledWith(0);
});

// Wide (no max-width match): a single-column board still scrolls its controls away.
it("stays docked on a wide screen when the board above it is a single column", () => {
  layout({ bottomInset: "0px" });
  jest
    .spyOn(window, "matchMedia")
    .mockImplementation((query) => ({ matches: false, media: query }) as MediaQueryList);
  const report = jest.fn();
  render(
    <GameDock label="Clues" sticky="always" onStickyHeightChange={report}>
      Clues
    </GameDock>,
  );
  expect(report).toHaveBeenLastCalledWith(200);
});
