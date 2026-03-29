type SlideshowKeyboardEventLike = {
  key: string;
  preventDefault: () => void;
  target: EventTarget | null;
};

type SlideshowKeyboardHandlers = {
  goNext: () => void;
  goPrevious: () => void;
  togglePaused: () => void;
  exit: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== "object") {
    return false;
  }

  const maybeElement = target as {
    tagName?: string;
    nodeName?: string;
    isContentEditable?: boolean;
  };
  const tagName = (maybeElement.tagName ?? maybeElement.nodeName ?? "").toUpperCase();

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    maybeElement.isContentEditable === true
  );
};

export const handleSlideshowKeyboardShortcut = (
  event: SlideshowKeyboardEventLike,
  handlers: SlideshowKeyboardHandlers,
): boolean => {
  if (isEditableTarget(event.target)) {
    return false;
  }

  if (event.key === "ArrowRight") {
    handlers.goNext();
    return true;
  }

  if (event.key === "ArrowLeft") {
    handlers.goPrevious();
    return true;
  }

  if (event.key === " ") {
    event.preventDefault();
    handlers.togglePaused();
    return true;
  }

  if (event.key === "Escape") {
    handlers.exit();
    return true;
  }

  return false;
};
