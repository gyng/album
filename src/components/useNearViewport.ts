import React from "react";

/** Mounted well before it is reached, so the map is ready rather than arriving. */
const DEFAULT_ROOT_MARGIN = "600px 0px";

const noSubscription = () => () => {};

/**
 * Whether this browser lacks `IntersectionObserver`. False on the server and
 * during hydration, so the first client render matches the server's.
 */
export const useIntersectionObserverMissing = (): boolean =>
  React.useSyncExternalStore(
    noSubscription,
    () => typeof IntersectionObserver === "undefined",
    () => false,
  );

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
 * Without `IntersectionObserver` — jsdom, an old browser — it reports
 * `whenUnobservable`, which defaults to true so ordinary content renders rather
 * than disappearing. A caller whose "near" branch is expensive should pass
 * false: mounting every one of them at once is worse than mounting none.
 */
export const useNearViewport = (
  ref: React.RefObject<Element | null>,
  rootMargin: string = DEFAULT_ROOT_MARGIN,
  whenUnobservable = true,
): boolean => {
  const [isNear, setIsNear] = React.useState(false);
  const unobservable = useIntersectionObserverMissing();

  React.useEffect(() => {
    if (unobservable) return;

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
  }, [ref, rootMargin, unobservable]);

  return unobservable ? whenUnobservable : isNear;
};
