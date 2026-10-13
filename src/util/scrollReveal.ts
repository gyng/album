export type ScrollRevealState = {
  y: number;
  direction: -1 | 0 | 1;
  distance: number;
  visible: boolean;
};

export const initialScrollReveal = (y = 0): ScrollRevealState => ({
  y,
  direction: 0,
  distance: 0,
  visible: true,
});

// Accumulate deliberate movement, rather than testing each tiny trackpad event.
export const advanceScrollReveal = (
  state: ScrollRevealState,
  y: number,
  hideAfter: number,
  keepVisible = false,
): ScrollRevealState => {
  if (keepVisible || y <= hideAfter) return initialScrollReveal(y);
  const delta = y - state.y;
  if (!delta) return state;
  const direction = delta > 0 ? 1 : -1;
  const distance =
    direction === state.direction ? state.distance + Math.abs(delta) : Math.abs(delta);
  const threshold = direction === 1 ? 24 : 32;
  const visible = distance >= threshold ? direction === -1 : state.visible;
  return { y, direction, distance, visible };
};
