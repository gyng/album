import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./GameDock.module.css";

/** Keep active game context in view only when there is room to use the content below. */
export const GameDock = ({
  children,
  label,
  active = true,
  className,
  onStickyHeightChange,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  className?: string;
  onStickyHeightChange?: (height: number) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) {
      setFits(false);
      onStickyHeightChange?.(0);
      return;
    }
    const measure = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const top = Number.parseFloat(getComputedStyle(element).insetBlockStart) || 8;
      const height = element.getBoundingClientRect().height;
      const canFit = viewport - height >= 144 + top;
      setFits(canFit);
      onStickyHeightChange?.(
        canFit && window.matchMedia("(max-width: 960px)").matches ? Math.ceil(height) : 0,
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
  }, [active, onStickyHeightChange]);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={[styles.dock, active && fits ? styles.active : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
};
