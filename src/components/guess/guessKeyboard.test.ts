import { isInteractiveTarget } from "./guessKeyboard";

describe("isInteractiveTarget", () => {
  it.each(["button", "A", "input", "TEXTAREA", "select"])(
    "preserves native keyboard handling for %s elements",
    (tagName) => {
      expect(isInteractiveTarget({ tagName } as unknown as EventTarget)).toBe(true);
    },
  );

  it("accepts nodeName for DOM-like event targets", () => {
    expect(isInteractiveTarget({ nodeName: "button" } as unknown as EventTarget)).toBe(true);
  });

  it("preserves keyboard handling for editable content", () => {
    expect(
      isInteractiveTarget({ tagName: "div", isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
  });

  it("allows game shortcuts for non-interactive and missing targets", () => {
    expect(isInteractiveTarget({ tagName: "div" } as unknown as EventTarget)).toBe(false);
    expect(isInteractiveTarget({} as EventTarget)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});
