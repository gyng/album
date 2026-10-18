import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./GameDock.module.css";

/** Keep active game context in view only when there is room to use the content below. */
export const GameDock = ({
  children,
  label,
  active = true,
  className,
  sticky = "narrow",
  onStickyHeightChange,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  className?: string;
  /** "always" for a board that stays one column on a wide screen, so nothing sits beside it. */
  sticky?: "narrow" | "always";
  onStickyHeightChange?: (height: number) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  const reportRef = useRef(onStickyHeightChange);
  useEffect(() => {
    reportRef.current = onStickyHeightChange;
  }, [onStickyHeightChange]);
  // A dock that leaves the page no longer holds space above anything.
  useEffect(() => () => reportRef.current?.(0), []);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) {
      setFits(false);
      onStickyHeightChange?.(0);
      return;
    }
    const measure = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const style = getComputedStyle(element);
      const top = Number.parseFloat(style.insetBlockStart) || 8;
      const bottom = Number.parseFloat(style.scrollPaddingBlockEnd) || 0;
      const height = element.getBoundingClientRect().height;
      const canFit = viewport - height >= 144 + top + bottom;
      setFits(canFit);
      onStickyHeightChange?.(
        canFit && (sticky === "always" || window.matchMedia("(max-width: 960px)").matches)
          ? Math.ceil(height)
          : 0,
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [active, sticky, onStickyHeightChange]);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={[
        styles.dock,
        active && fits ? styles.active : "",
        active && fits && sticky === "always" ? styles.always : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
};
