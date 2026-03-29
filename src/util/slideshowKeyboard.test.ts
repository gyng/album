describe("handleSlideshowKeyboardShortcut", () => {
  const setup = async () => {
    const { handleSlideshowKeyboardShortcut } = await import(
      "./slideshowKeyboard"
    );

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
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

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
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "ArrowLeft", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.goPrevious).toHaveBeenCalledTimes(1);
    expect(handlers.goNext).not.toHaveBeenCalled();
  });

  it("handles Space and prevents default", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: " ", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.togglePaused).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("handles Escape", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "Escape", preventDefault, target: null },
      handlers,
    );

    expect(handled).toBe(true);
    expect(handlers.exit).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while an input is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "ArrowRight", preventDefault, target: { tagName: "input" } as EventTarget },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.goNext).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while a textarea is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: "Escape", preventDefault, target: { tagName: "textarea" } as EventTarget },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.exit).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while a select is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      { key: " ", preventDefault, target: { tagName: "select" } as EventTarget },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.togglePaused).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while contenteditable is focused", async () => {
    const { handleSlideshowKeyboardShortcut, handlers, preventDefault } =
      await setup();

    const handled = handleSlideshowKeyboardShortcut(
      {
        key: "ArrowLeft",
        preventDefault,
        target: { isContentEditable: true } as EventTarget,
      },
      handlers,
    );

    expect(handled).toBe(false);
    expect(handlers.goPrevious).not.toHaveBeenCalled();
  });
});
