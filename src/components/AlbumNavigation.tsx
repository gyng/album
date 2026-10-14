import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { advanceScrollReveal, initialScrollReveal } from "../util/scrollReveal";
import styles from "./AlbumNavigation.module.css";

// The nav keeps its original place in the document. Only the inner surface
// translates, leaving the photographs and the existing nav-position motion alone.
export const AlbumNavigation = ({
  navigation,
  children,
  routeKey,
}: {
  navigation: ReactNode;
  children: ReactNode;
  routeKey: string;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const height = useRef(0);

  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    const measure = () => {
      height.current = node.getBoundingClientRect().height;
      root.current?.style.setProperty("--album-nav-height", `${height.current}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    let state = initialScrollReveal(window.scrollY);
    let frame: number | null = null;
    let hasInteracted = false;
    let viewportWidth = window.innerWidth;
    const mobile = window.matchMedia("(max-width: 720px)");
    setVisible(true);
    const position = () =>
      Math.max(
        0,
        Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight),
      );
    const reset = () => {
      hasInteracted = false;
      state = initialScrollReveal(position());
      setVisible(true);
    };
    const restore = (event: PageTransitionEvent) => {
      // The initial pageshow can arrive after the reader starts scrolling while
      // images load. Only a history restoration should discard that intent.
      if (event.persisted) reset();
    };
    const resize = () => {
      // Mobile address bars change viewport height during a scroll. Preserve
      // the gesture; only a width change needs a fresh navigation layout.
      if (window.innerWidth === viewportWidth) return;
      viewportWidth = window.innerWidth;
      reset();
    };
    const update = () => {
      frame = null;
      const y = position();
      if (!mobile.matches || !hasInteracted) {
        state = initialScrollReveal(y);
        setVisible(true);
        return;
      }
      // Overscroll and a modal's nested scrolling are not requests to move the nav.
      if (
        window.scrollY < 0 ||
        window.scrollY > document.documentElement.scrollHeight - window.innerHeight ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      ) {
        state = { ...state, y, direction: 0, distance: 0 };
        return;
      }
      const inUse =
        node.contains(document.activeElement) ||
        Boolean(node.querySelector('[aria-expanded="true"], details[open]'));
      state = advanceScrollReveal(state, y, height.current, inUse);
      setVisible(state.visible);
    };
    const scroll = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const focus = () => {
      state = initialScrollReveal(position());
      setVisible(true);
    };
    const interact = () => {
      hasInteracted = true;
    };
    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        interact();
    };
    const scrollbar = (event: PointerEvent) => {
      if (event.target === document.documentElement) interact();
    };
    node.addEventListener("focusin", focus);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pageshow", restore);
    window.addEventListener("resize", resize);
    window.addEventListener("wheel", interact, { passive: true });
    window.addEventListener("touchstart", interact, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", scrollbar);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      node.removeEventListener("focusin", focus);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("resize", resize);
      window.removeEventListener("wheel", interact);
      window.removeEventListener("touchstart", interact);
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", scrollbar);
    };
  }, [routeKey]);

  return (
    <div ref={root} className={styles.album}>
      <div className={styles.slot} data-nav-viewport-motion>
        <div
          ref={surface}
          className={[styles.surface, !visible ? styles.hidden : ""].filter(Boolean).join(" ")}
        >
          {navigation}
        </div>
      </div>
      {children}
    </div>
  );
};
