import { advanceScrollReveal, initialScrollReveal } from "./scrollReveal";

it("stays visible near the top and hides after deliberate downward travel", () => {
  let state = initialScrollReveal();
  state = advanceScrollReveal(state, 140, 160);
  expect(state.visible).toBe(true);
  state = advanceScrollReveal(state, 161, 160);
  expect(state.visible).toBe(true);
  state = advanceScrollReveal(state, 164, 160);
  expect(state.visible).toBe(false);
});

it("accumulates small events and ignores a brief upward reversal", () => {
  let state = { ...initialScrollReveal(500), visible: false };
  for (let y = 499; y >= 469; y--) state = advanceScrollReveal(state, y, 160);
  expect(state.visible).toBe(false);
  state = advanceScrollReveal(state, 468, 160);
  expect(state.visible).toBe(true);
  state = advanceScrollReveal(state, 480, 160);
  expect(state.visible).toBe(true);
  state = advanceScrollReveal(state, 490, 160);
  expect(state.visible).toBe(true);
  state = advanceScrollReveal(state, 492, 160);
  expect(state.visible).toBe(false);
});

it("reveals focused navigation and resets movement while it is in use", () => {
  const hidden = { ...initialScrollReveal(500), visible: false };
  const focused = advanceScrollReveal(hidden, 600, 160, true);
  expect(focused).toEqual(initialScrollReveal(600));
  expect(advanceScrollReveal(focused, 610, 160).visible).toBe(true);
});

it("always returns at the top, including a restored or linked position", () => {
  const hidden = { ...initialScrollReveal(500), visible: false };
  expect(advanceScrollReveal(hidden, 0, 160).visible).toBe(true);
  expect(initialScrollReveal(500).visible).toBe(true);
});
