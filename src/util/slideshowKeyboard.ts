type SlideshowKeyboardEventLike = {
  key: string;
  preventDefault: () => void;
  target: EventTarget | null;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
};

type SlideshowKeyboardHandlers = {
  goNext: () => void;
  goPrevious: () => void;
  togglePaused: () => void;
  exit: () => void;
  toggleMute?: () => void;
  toggleLoop?: () => void;
};

type ElementLike = {
  tagName?: string;
  nodeName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
};

const describeTarget = (target: EventTarget | null): { tagName: string; role: string } | null => {
  if (!target || typeof target !== "object") {
    return null;
  }
  const element = target as ElementLike;
  return {
    tagName: (element.tagName ?? element.nodeName ?? "").toUpperCase(),
    role: (typeof element.getAttribute === "function" ? element.getAttribute("role") : null) ?? "",
  };
};

// Somewhere the keys are the reader's own typing or adjusting: every shortcut
// stands down. A slider is here because its arrows move its thumb.
const isEditableTarget = (target: EventTarget | null): boolean => {
  const shape = describeTarget(target);
  if (!shape) return false;
  return (
    shape.tagName === "INPUT" ||
    shape.tagName === "TEXTAREA" ||
    shape.tagName === "SELECT" ||
    shape.role === "slider" ||
    shape.role === "textbox" ||
    (target as ElementLike).isContentEditable === true
  );
};

// A control that Space (or Enter) activates by itself. Taking Space as the
// pause shortcut there paused the show and pressed the button in one stroke.
const isActivatableTarget = (target: EventTarget | null): boolean => {
  const shape = describeTarget(target);
  if (!shape) return false;
  return (
    shape.tagName === "BUTTON" ||
    shape.tagName === "A" ||
    shape.tagName === "SUMMARY" ||
    shape.role === "button" ||
    shape.role === "link"
  );
};

export const handleSlideshowKeyboardShortcut = (
  event: SlideshowKeyboardEventLike,
  handlers: SlideshowKeyboardHandlers,
): boolean => {
  if (isEditableTarget(event.target)) {
    return false;
  }
  // Alt+← and Cmd+← are the browser's Back, Ctrl+L its address bar: a chord is
  // never one of these shortcuts.
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  if (event.key === "Escape") {
    handlers.exit();
    return true;
  }

  // Everything else acts once per press: a held key repeats, and each repeat
  // started another advance or flipped the setting back.
  if (event.repeat) {
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
    if (isActivatableTarget(event.target)) {
      return false;
    }
    event.preventDefault();
    handlers.togglePaused();
    return true;
  }

  const letter = event.key.toLowerCase();
  if (letter === "m" && handlers.toggleMute) {
    handlers.toggleMute();
    return true;
  }
  if (letter === "l" && handlers.toggleLoop) {
    handlers.toggleLoop();
    return true;
  }

  return false;
};
