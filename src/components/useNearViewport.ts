import React from "react";

/** Mounted well before it is reached, so the map is ready rather than arriving. */
const DEFAULT_ROOT_MARGIN = "600px 0px";

/**
 * Whether an element is near enough to the viewport to be worth rendering.
 *
 * Unlike the one-way deferral the explore page uses, this **turns off again**
 * when the element leaves. That is the whole point here: the trip list can grow
 * to every journey in the archive, and each live route map holds a WebGL
 * context — a browser gives out somewhere around sixteen before it starts
 * dropping the oldest, so a one-way gate would quietly kill the maps a reader
 * scrolled past on their way down.
 *
 * Without `IntersectionObserver` — jsdom, an old browser — it reports true, so
 * the content renders rather than disappearing.
 */
export const useNearViewport = (
  ref: React.RefObject<Element | null>,
  rootMargin: string = DEFAULT_ROOT_MARGIN,
): boolean => {
  const [isNear, setIsNear] = React.useState(false);

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setIsNear(true);
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setIsNear(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return isNear;
};
