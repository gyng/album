/**
 * True when a keyboard event originated from an interactive element that has
 * its own Enter/Space behaviour (buttons, links, form controls, contentEditable).
 *
 * The guess game installs window-level Enter/Space shortcuts (start the game,
 * confirm a guess, advance). Without this guard those shortcuts hijack the
 * focused control — e.g. tabbing to "Daily challenge" and pressing Enter would
 * start a normal game instead of activating the focused button. Bail out for
 * interactive targets so they keep their native activation.
 */
export const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== "object") return false;

  const element = target as {
    tagName?: string;
    nodeName?: string;
    isContentEditable?: boolean;
  };
  const tagName = (element.tagName ?? element.nodeName ?? "").toUpperCase();

  return (
    tagName === "BUTTON" ||
    tagName === "A" ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    element.isContentEditable === true
  );
};
