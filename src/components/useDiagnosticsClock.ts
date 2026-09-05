import { useEffect, useState } from "react";

/** Tick only while diagnostics are open; never redraw an unattended slideshow. */
export const useDiagnosticsClock = (enabled: boolean): number => {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled]);
  return now;
};
