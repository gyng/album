import React, { useCallback, useEffect } from "react";

type WakeLockSentinel = EventTarget & {
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

export type UseWakeLock = {
  // Live sentinel ref — consumers (e.g. the kiosk DB-update poll and the
  // fallback reload) read `.current` to decide whether a wake lock is held.
  ref: React.RefObject<WakeLockSentinel | null>;
  isSupported: boolean;
  isActive: boolean;
  acquire: () => Promise<void>;
  release: () => Promise<void>;
};

// Screen wake-lock lifecycle for the slideshow kiosk: acquire on load and on
// resume (visibilitychange / Safari PWA pageshow), release on unmount or when
// disabled. Extracted verbatim from the slideshow page so the behaviour — and
// the Safari-specific handling baked into the comments — is preserved exactly.
export const useWakeLock = (disabled: boolean): UseWakeLock => {
  const [isSupported, setIsSupported] = React.useState(false);
  const [isActive, setIsActive] = React.useState(false);
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;

    // Capability detection must run in an effect (client-only): `navigator` is
    // undefined during SSR, so a lazy useState initialiser would throw.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSupported(typeof wakeLock?.request === "function");
  }, []);

  const release = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    setIsActive(false);

    if (!sentinel) {
      return;
    }

    try {
      await sentinel.release();
    } catch (error) {
      console.error(error);
    }
  }, []);

  const acquire = useCallback(async () => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (
      disabled ||
      document.visibilityState !== "visible" ||
      typeof wakeLock?.request !== "function"
    ) {
      await release();
      return;
    }

    if (wakeLockRef.current) {
      setIsActive(true);
      return;
    }

    try {
      const sentinel = await wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setIsActive(true);
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
        }
        setIsActive(false);
      });
    } catch (error) {
      console.error(error);
      wakeLockRef.current = null;
      setIsActive(false);
    }
  }, [disabled, release]);

  useEffect(() => {
    if (!disabled) {
      return;
    }

    // Releasing the platform wake lock is an external-system sync; the state
    // update merely reflects its result, which is the legitimate use of an
    // effect here (not a derived-state cascade).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    release().catch(console.error);
  }, [disabled, release]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    // Try once on load so kiosk/photo-frame sessions wake-lock automatically
    // where browsers permit non-gesture acquisition. External-system sync —
    // the state update reflects the acquired lock.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    acquire().catch(console.error);
  }, [disabled, acquire]);

  useEffect(() => {
    const syncWakeLockState = () => {
      if (document.visibilityState !== "visible") {
        setIsActive(false);
        return;
      }

      if (!disabled) {
        acquire().catch(console.error);
      }
    };

    // pageshow fires in Safari PWAs when the page is restored from the back/forward cache
    // or resumed from background — more reliable than visibilitychange alone in that context.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) {
        return;
      }
      syncWakeLockState();
    };

    document.addEventListener("visibilitychange", syncWakeLockState);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", syncWakeLockState);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [disabled, acquire]);

  useEffect(() => {
    return () => {
      release().catch(console.error);
    };
  }, [release]);

  return { ref: wakeLockRef, isSupported, isActive, acquire, release };
};
