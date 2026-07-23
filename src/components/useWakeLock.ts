import React, { useCallback, useEffect } from "react";

type WakeLockSentinel = EventTarget & {
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

// Internal wake-lock outcomes the shell cannot observe from `isActive` alone:
// a rejected re-acquire, hitting the give-up cap, and decaying that cap to retry
// unattended. The shell records lock acquisition/loss itself from `isActive`
// transitions; the hook pushes only these facts it alone knows.
export type WakeLockEvent = "reacquire-failed" | "cap-reached" | "cap-decayed";

export type UseWakeLock = {
  // Live sentinel ref — consumers (e.g. the kiosk DB-update poll and the
  // fallback reload) read `.current` to decide whether a wake lock is held.
  ref: React.RefObject<WakeLockSentinel | null>;
  isSupported: boolean;
  isActive: boolean;
  acquire: () => Promise<void>;
  release: () => Promise<void>;
  // Subscribe to internal outcomes for the persistent wake event log. Push-based
  // (not a polled ref) so the log is exact and the callback identity is stable,
  // never churning the hook's effects. Returns an unsubscribe.
  subscribe: (listener: (event: WakeLockEvent) => void) => () => void;
};

// After the system silently drops a held lock (iPadOS does this for thermal /
// battery / system-UI reasons while the page stays visible), wait this long
// before re-acquiring. The delay stops a tight loop if the platform instantly
// re-releases the fresh lock.
const SYSTEM_REACQUIRE_DELAY_MS = 1500;
// A lock held at least this long counts as a genuine success and resets the
// consecutive re-acquire counter — a brief blip is a fight, a long hold is not.
const SUSTAINED_HOLD_MS = 30000;
// Give up the release-driven re-acquire loop after this many consecutive
// attempts that never achieved a sustained hold, to avoid a battery-draining
// fight with the OS. A visibility change or a user gesture (both reach the
// public acquire()) resets the count and revives the loop.
const MAX_SYSTEM_REACQUIRES = 5;
// While enabled and visible, re-check every minute that a lock is actually
// held; a transiently rejected request recovers once conditions clear. A held
// lock makes the check a no-op.
const WAKE_WATCHDOG_INTERVAL_MS = 60000;
// Once the give-up cap is reached, an unattended kiosk still deserves a chance
// to recover after the OS condition clears. When this long has passed since the
// last re-acquire attempt, the watchdog decays the cap and tries again — worst
// case one 5-attempt burst per this window, so the fight cannot drain a battery
// yet the kiosk self-heals overnight without a human tap.
const REACQUIRE_CAP_DECAY_MS = 600000;

// Screen wake-lock lifecycle for the slideshow kiosk: acquire on load and on
// resume (visibilitychange / Safari PWA pageshow), release on unmount or when
// disabled. It also self-heals when the SYSTEM drops the lock underneath a
// visible page — the platform fires the sentinel's "release" event without any
// deliberate release() call, so the hook re-acquires (capped, to avoid fighting
// the OS forever) and a slow watchdog recovers transiently rejected requests.
export const useWakeLock = (disabled: boolean): UseWakeLock => {
  const [isSupported, setIsSupported] = React.useState(false);
  const [isActive, setIsActive] = React.useState(false);
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);
  // Guards overlapping acquires: request() is async, so two callers could each
  // pass the "not currently held" check and each obtain a sentinel — leaking
  // the first (the screen would stay awake with an untracked lock).
  const isAcquiringRef = React.useRef(false);
  // Bumped on every release so an acquire that is still awaiting request() can
  // tell it was superseded (released / navigated away / disabled) and let go of
  // the late-arriving sentinel instead of storing it.
  const releaseGenerationRef = React.useRef(0);
  // When the currently-held lock was acquired, so a system release can measure
  // whether it managed a sustained hold before deciding to keep fighting.
  const acquiredAtRef = React.useRef(0);
  // Consecutive release-driven re-acquires without a sustained hold in between.
  const systemReacquireCountRef = React.useRef(0);
  // Pending delayed re-acquire after a system release, so a deliberate release
  // or unmount can cancel it.
  const reacquireTimerRef = React.useRef<number | null>(null);
  // When the last re-acquire attempt fired (release-listener retry or watchdog),
  // so the watchdog can decay the give-up cap after a long unattended gap.
  const lastReacquireAttemptAtRef = React.useRef(0);
  // Subscribers to internal wake outcomes (the persistent event log). A plain
  // Set kept in a ref, so subscribing never re-runs the hook's effects.
  const eventListenersRef = React.useRef(new Set<(event: WakeLockEvent) => void>());
  // Current `disabled` for the release listener / watchdog, whose closures must
  // not act on a stale value.
  const disabledRef = React.useRef(disabled);
  // Stable indirection to the latest acquire so the release listener and the
  // watchdog interval can trigger a re-acquire without depending on acquire's
  // identity (which would churn the listener / reset the interval).
  const runAcquireRef = React.useRef<(resetGiveUp: boolean) => void>(() => {});

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;

    // Capability detection must run in an effect (client-only): `navigator` is
    // undefined during SSR, so a lazy useState initialiser would throw.

    setIsSupported(typeof wakeLock?.request === "function");
  }, []);

  const emitEvent = useCallback((event: WakeLockEvent) => {
    for (const listener of eventListenersRef.current) {
      listener(event);
    }
  }, []);

  const subscribe = useCallback((listener: (event: WakeLockEvent) => void) => {
    eventListenersRef.current.add(listener);
    return () => {
      eventListenersRef.current.delete(listener);
    };
  }, []);

  const clearReacquireTimer = useCallback(() => {
    if (reacquireTimerRef.current !== null) {
      window.clearTimeout(reacquireTimerRef.current);
      reacquireTimerRef.current = null;
    }
  }, []);

  const release = useCallback(async () => {
    // Invalidate any in-flight acquire so its late sentinel is let go, not kept,
    // and cancel any pending system-release re-acquire.
    releaseGenerationRef.current += 1;
    clearReacquireTimer();
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
  }, [clearReacquireTimer]);

  // `resetGiveUp` distinguishes an intentional acquire (mount, visibility
  // resume, or a user gesture) — which clears the give-up counter and revives
  // the re-acquire loop — from an internal retry (release listener / watchdog),
  // which must not reset the counter or the cap could never be reached.
  const acquire = useCallback(
    async (resetGiveUp = true) => {
      if (resetGiveUp) {
        systemReacquireCountRef.current = 0;
      }
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

      // Collapse concurrent acquires into a single platform request.
      if (isAcquiringRef.current) {
        return;
      }
      isAcquiringRef.current = true;
      const generation = releaseGenerationRef.current;

      try {
        const sentinel = await wakeLock.request("screen");

        // Superseded while awaiting — a release/unmount/disable happened, or a
        // parallel acquire already installed a lock. Let this sentinel go rather
        // than leak it (this is the Escape-nav "screen stays awake" case).
        if (releaseGenerationRef.current !== generation || wakeLockRef.current) {
          try {
            await sentinel.release();
          } catch (error) {
            console.error(error);
          }
          return;
        }

        wakeLockRef.current = sentinel;
        acquiredAtRef.current = Date.now();
        setIsActive(true);
        sentinel.addEventListener("release", () => {
          // Only the currently-held sentinel may flip state off; a superseded
          // one firing its release event must not clear a newer lock. A
          // deliberate release() nulls this ref and bumps the generation BEFORE
          // awaiting sentinel.release(), so this guard is already false for
          // deliberate paths — only a SYSTEM-initiated drop reaches the body.
          if (wakeLockRef.current !== sentinel) {
            return;
          }
          const heldMs = Date.now() - acquiredAtRef.current;
          wakeLockRef.current = null;
          setIsActive(false);
          // A sustained hold that the system later dropped is not a fight —
          // start the retry budget fresh.
          if (heldMs >= SUSTAINED_HOLD_MS) {
            systemReacquireCountRef.current = 0;
          }
          if (disabledRef.current || document.visibilityState !== "visible") {
            return;
          }
          if (systemReacquireCountRef.current >= MAX_SYSTEM_REACQUIRES) {
            // Gave up fighting the OS — wait for a visibility change or gesture
            // (public acquire()) to reset the counter, or for the watchdog to
            // decay the cap after a long unattended gap.
            emitEvent("cap-reached");
            return;
          }
          systemReacquireCountRef.current += 1;
          clearReacquireTimer();
          reacquireTimerRef.current = window.setTimeout(() => {
            reacquireTimerRef.current = null;
            lastReacquireAttemptAtRef.current = Date.now();
            runAcquireRef.current(false);
          }, SYSTEM_REACQUIRE_DELAY_MS);
        });
      } catch (error) {
        console.error(error);
        // Don't clobber a lock another acquire may have installed meanwhile.
        if (!wakeLockRef.current) {
          setIsActive(false);
        }
        // Only an internal retry (release listener / watchdog) is a "re-acquire"
        // — a first/deliberate acquire that fails is not logged as one.
        if (!resetGiveUp) {
          emitEvent("reacquire-failed");
        }
      } finally {
        isAcquiringRef.current = false;
      }
    },
    [disabled, release, clearReacquireTimer, emitEvent],
  );

  useEffect(() => {
    runAcquireRef.current = (resetGiveUp: boolean) => {
      void acquire(resetGiveUp);
    };
  }, [acquire]);

  useEffect(() => {
    if (!disabled) {
      return;
    }

    // Releasing the platform wake lock is an external-system sync; the state
    // update merely reflects its result, which is the legitimate use of an
    // effect here (not a derived-state cascade).

    release().catch(console.error);
  }, [disabled, release]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    // Try once on load so kiosk/photo-frame sessions wake-lock automatically
    // where browsers permit non-gesture acquisition. External-system sync —
    // the state update reflects the acquired lock.

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
    if (disabled) {
      return;
    }

    // Slow safety net: a request rejected transiently (Safari low battery, a
    // momentary system-UI takeover) leaves no lock and fires no "release"
    // event to retry from. Re-check on a minute cadence and re-acquire if the
    // page is visible and nothing is held. A held lock short-circuits to a
    // no-op inside acquire().
    const interval = window.setInterval(() => {
      if (disabledRef.current || document.visibilityState !== "visible") {
        return;
      }
      if (wakeLockRef.current || isAcquiringRef.current) {
        return;
      }
      if (systemReacquireCountRef.current >= MAX_SYSTEM_REACQUIRES) {
        // The cap holds until a long quiet gap has passed since the last attempt,
        // then it decays so an unattended kiosk recovers once the OS relents.
        if (Date.now() - lastReacquireAttemptAtRef.current < REACQUIRE_CAP_DECAY_MS) {
          return;
        }
        systemReacquireCountRef.current = 0;
        emitEvent("cap-decayed");
      }
      lastReacquireAttemptAtRef.current = Date.now();
      runAcquireRef.current(false);
    }, WAKE_WATCHDOG_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [disabled, emitEvent]);

  useEffect(() => {
    return () => {
      release().catch(console.error);
    };
  }, [release]);

  return { ref: wakeLockRef, isSupported, isActive, acquire, release, subscribe };
};
