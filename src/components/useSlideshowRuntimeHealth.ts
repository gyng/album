import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { BUILD_VERSION } from "../lib/buildVersion";
import { SLIDESHOW_RUNTIME_STATE_MESSAGE } from "../util/slideshowShell";
import { RUNTIME_HEARTBEAT_MS } from "../util/slideshowRuntimeHealth";

// Lives with the actual slideshow, not its wrapper: an error boundary that
// unmounts the slideshow must stop the lease. The shell owns recovery and keeps
// its last photograph; this controller only reports observable runtime state.
export const useSlideshowRuntimeHealth = (input: {
  enabled: boolean;
  photo: string | null;
  slideKey: string | null;
  paused: boolean;
  nextAdvanceAt: number | null;
}) => {
  const current = useRef(input);
  // Before any effect below reads it, and never during render.
  useLayoutEffect(() => {
    current.current = input;
  });
  const presented = useRef<{ key: string; at: number } | null>(null);
  const pendingSince = useRef<number | null>(null);
  const send = useCallback(() => {
    const state = current.current;
    if (!state.enabled || document.visibilityState !== "visible") return;
    if (
      state.slideKey &&
      state.slideKey !== presented.current?.key &&
      pendingSince.current === null
    ) {
      pendingSince.current = Date.now();
    }
    window.parent.postMessage(
      {
        type: SLIDESHOW_RUNTIME_STATE_MESSAGE,
        buildVersion: BUILD_VERSION,
        health: {
          photo: state.photo,
          presentedAt: presented.current?.at ?? null,
          pendingSince: pendingSince.current,
          paused: state.paused,
          nextAdvanceAt: state.nextAdvanceAt,
        },
      },
      window.location.origin,
    );
  }, []);
  useEffect(() => {
    if (!input.enabled) return;
    send();
    const interval = window.setInterval(send, RUNTIME_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", send);
    };
  }, [input.enabled, send]);
  return useCallback(
    (key: string) => {
      presented.current = { key, at: Date.now() };
      pendingSince.current = null;
      send();
    },
    [send],
  );
};
