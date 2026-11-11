describe("handleSlideshowKeyboardShortcut", () => {
  const setup = async () => {
    const { handleSlideshowKeyboardShortcut } = await import("./slideshowKeyboard");

    const handlers = {
      goNext: jest.fn(),
      goPrevious: jest.fn(),
      togglePaused: jest.fn(),
      exit: jest.fn(),
    };

    const preventDefault = jest.fn();

    return {
      handleSlideshowKeyboardShortcut,
      handlers,
      preventDefault,
    };
  };

  it("handles ArrowRight", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "ArrowRight", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.goNext).toHaveBeenCalledTimes(1);
    expect(handlers.goPrevious).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("handles ArrowLeft", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "ArrowLeft", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.goPrevious).toHaveBeenCalledTimes(1);
    expect(handlers.goNext).not.toHaveBeenCalled();
  });

  it("handles Space and prevents default", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: " ", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.togglePaused).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("handles Escape", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "Escape", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.exit).toHaveBeenCalledTimes(1);
  });

  it("returns false for an unrelated key", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    expect(
      handleSlideshowKeyboardShortcut({ key: "Home", preventDefault, target: null }, handlers),
    ).toBe(false);
    expect(Object.values(handlers).every((handler) => handler.mock.calls.length === 0)).toBe(true);
  });

  it("ignores shortcuts while an input is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "ArrowRight", preventDefault, target: { tagName: "input" } as unknown as EventTarget },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.goNext).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while a textarea is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "Escape", preventDefault, target: { tagName: "textarea" } as unknown as EventTarget },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.exit).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while a select is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: " ", preventDefault, target: { tagName: "select" } as unknown as EventTarget },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.togglePaused).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while contenteditable is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

    const handled = handleSlideshowKeyboardShortcut(
      {
        key: "ArrowLeft",
        preventDefault,
        target: { isContentEditable: true } as unknown as EventTarget,
      },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.goPrevious).not.toHaveBeenCalled();
  });
  // Alt+← and Cmd+← are the browser's Back: they must not also step the show.
  it.each(["altKey", "ctrlKey", "metaKey"] as const)(
    "ignores a shortcut held with %s",
    async (mod) => {
      const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();

      const handled = handleSlideshowKeyboardShortcut(
        { key: "ArrowLeft", preventDefault, target: null, [mod]: true },
        handlers,
      );

      expect(handled).toBe(false);
      expect(handlers.goPrevious).not.toHaveBeenCalled();
    },
  );

  // A held arrow key repeats; each repeat used to start another advance.
  it.each(["ArrowRight", "ArrowLeft", " ", "m", "l"])("ignores key repeat for %p", async (key) => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();
    const extra = { toggleMute: jest.fn(), toggleLoop: jest.fn() };

    const handled = handleSlideshowKeyboardShortcut(
      { key, preventDefault, target: null, repeat: true },
      { ...handlers, ...extra },
    );

    expect(handled).toBe(false);
    expect(
      Object.values({ ...handlers, ...extra }).every((handler) => handler.mock.calls.length === 0),
    ).toBe(true);
  });

  // Space on a focused button is that button's own activation; taking it as
  // the pause shortcut too did both at once.
  it.each([{ tagName: "BUTTON" }, { tagName: "A" }, { tagName: "DIV", role: "slider" }])(
    "leaves Space to a focused control (%p)",
    async (shape) => {
      const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();
      const target = {
        tagName: shape.tagName,
        getAttribute: (name: string) => (name === "role" ? (shape.role ?? null) : null),
      } as unknown as EventTarget;

      expect(handleSlideshowKeyboardShortcut({ key: " ", preventDefault, target }, handlers)).toBe(
        false,
      );
      expect(handlers.togglePaused).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
      // Arrows are not a button's keys, so they still step the show.
      expect(
        handleSlideshowKeyboardShortcut({ key: "ArrowRight", preventDefault, target }, handlers),
      ).toBe(shape.role !== "slider");
    },
  );

  it("toggles mute on M and loop on L", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } = await setup();
    const extra = { toggleMute: jest.fn(), toggleLoop: jest.fn() };

    expect(
      handleSlideshowKeyboardShortcut(
        { key: "m", preventDefault, target: null },
        { ...handlers, ...extra },
      ),
    ).toBe(true);
    expect(
      handleSlideshowKeyboardShortcut(
        { key: "L", preventDefault, target: null },
        { ...handlers, ...extra },
      ),
    ).toBe(true);
    expect(extra.toggleMute).toHaveBeenCalledTimes(1);
    expect(extra.toggleLoop).toHaveBeenCalledTimes(1);
  });
});
