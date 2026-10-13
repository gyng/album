import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./GameDock.module.css";

/** Keep active game context in view only when there is room to use the content below. */
export const GameDock = ({
  children,
  label,
  active = true,
  className,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) {
      setFits(false);
      return;
    }
    const measure = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const top = Number.parseFloat(getComputedStyle(element).insetBlockStart) || 8;
      setFits(viewport - element.getBoundingClientRect().height >= 144 + top);
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
  }, [active]);
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
