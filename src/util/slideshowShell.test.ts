import {
  buildSlideshowRuntimeUrl,
  isModifiedClick,
  isSlideshowRuntimeMessage,
  isSlideshowShellStateMessage,
  MAX_RUNTIME_RELOAD_ATTEMPTS,
  planRuntimeReload,
  recordRuntimeReload,
  RUNTIME_RELOAD_BASE_DELAY_MS,
  SLIDESHOW_EXIT_MESSAGE,
  SLIDESHOW_NAVIGATE_MESSAGE,
  SLIDESHOW_RUNTIME_STATE_MESSAGE,
  SLIDESHOW_SHELL_STATE_MESSAGE,
} from "./slideshowShell";

const click = (overrides: Partial<Parameters<typeof isModifiedClick>[0]> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  button: 0,
  ...overrides,
});

describe("slideshow shell protocol", () => {
  it("builds an explicitly managed runtime URL and replaces stale shell versions", () => {
    expect(buildSlideshowRuntimeUrl("?filter=favourites&shellVersion=old", "new build")).toBe(
      "/slideshow?filter=favourites&shell=1&shellVersion=new+build",
    );
  });

  it("accepts only complete runtime messages", () => {
    expect(
      isSlideshowRuntimeMessage({
        type: SLIDESHOW_RUNTIME_STATE_MESSAGE,
        buildVersion: "build-2",
      }),
    ).toBe(true);
    expect(isSlideshowRuntimeMessage({ type: SLIDESHOW_EXIT_MESSAGE })).toBe(true);
    expect(
      isSlideshowRuntimeMessage({ type: SLIDESHOW_NAVIGATE_MESSAGE, href: "/album/japan" }),
    ).toBe(true);
    expect(
      isSlideshowRuntimeMessage({ type: SLIDESHOW_NAVIGATE_MESSAGE, href: "//example.com" }),
    ).toBe(false);
    expect(
      isSlideshowRuntimeMessage({ type: SLIDESHOW_RUNTIME_STATE_MESSAGE, buildVersion: " " }),
    ).toBe(false);
    expect(isSlideshowRuntimeMessage({ type: "unrelated" })).toBe(false);
  });

  it("treats modifier and non-primary-button clicks as browser-managed", () => {
    expect(isModifiedClick(click())).toBe(false);
    expect(isModifiedClick(click({ metaKey: true }))).toBe(true);
    expect(isModifiedClick(click({ ctrlKey: true }))).toBe(true);
    expect(isModifiedClick(click({ shiftKey: true }))).toBe(true);
    expect(isModifiedClick(click({ altKey: true }))).toBe(true);
    expect(isModifiedClick(click({ button: 1 }))).toBe(true);
  });

  it("reloads a fresh target immediately, then caps retries with backoff as reloads execute", () => {
    // First sight of a target reloads at once (a real deploy). Planning is a pure
    // read-only decision; the attempt count advances only when a reload runs.
    let tracker = null as ReturnType<typeof recordRuntimeReload> | null;
    const first = planRuntimeReload("build-next", tracker);
    expect(first).toEqual({ shouldReload: true, delayMs: 0 });
    tracker = recordRuntimeReload("build-next", tracker);
    expect(tracker).toEqual({ targetVersion: "build-next", attempts: 1 });

    // Retries toward the same target back off with an escalating delay.
    const second = planRuntimeReload("build-next", tracker);
    expect(second.shouldReload).toBe(true);
    expect(second.delayMs).toBe(RUNTIME_RELOAD_BASE_DELAY_MS);
    tracker = recordRuntimeReload("build-next", tracker);

    const third = planRuntimeReload("build-next", tracker);
    expect(third.shouldReload).toBe(true);
    expect(third.delayMs).toBe(RUNTIME_RELOAD_BASE_DELAY_MS * 2);
    tracker = recordRuntimeReload("build-next", tracker);

    // Budget exhausted (three reloads executed) — hold until the target changes.
    expect(tracker.attempts).toBe(MAX_RUNTIME_RELOAD_ATTEMPTS);
    const held = planRuntimeReload("build-next", tracker);
    expect(held.shouldReload).toBe(false);
  });

  it("does not spend the budget when reloads are planned but never executed", () => {
    // A kiosk waking several times inside one backoff window drives the planner
    // repeatedly, but until a frame actually reloads the count must not move —
    // otherwise a single real reload could exhaust the whole budget.
    const tracker = { targetVersion: "build-next", attempts: 1 };
    planRuntimeReload("build-next", tracker);
    planRuntimeReload("build-next", tracker);
    planRuntimeReload("build-next", tracker);
    expect(tracker).toEqual({ targetVersion: "build-next", attempts: 1 });

    // Only an executed reload advances the count, and by exactly one.
    expect(recordRuntimeReload("build-next", tracker)).toEqual({
      targetVersion: "build-next",
      attempts: 2,
    });
  });

  it("resets the retry budget when the target version changes", () => {
    const exhausted = { targetVersion: "build-next", attempts: MAX_RUNTIME_RELOAD_ATTEMPTS };
    const plan = planRuntimeReload("build-newer", exhausted);
    expect(plan.shouldReload).toBe(true);
    expect(plan.delayMs).toBe(0);
    expect(recordRuntimeReload("build-newer", exhausted)).toEqual({
      targetVersion: "build-newer",
      attempts: 1,
    });
  });

  it("requires both wake-lock capability fields from shell state", () => {
    expect(
      isSlideshowShellStateMessage({
        type: SLIDESHOW_SHELL_STATE_MESSAGE,
        isSupported: true,
        isActive: false,
      }),
    ).toBe(true);
    expect(
      isSlideshowShellStateMessage({
        type: SLIDESHOW_SHELL_STATE_MESSAGE,
        isSupported: true,
      }),
    ).toBe(false);
  });
});
