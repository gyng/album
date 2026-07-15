/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchDrawPad } from "./SearchDrawPad";

// jsdom has no canvas implementation — getContext returns null and the
// component guards for that, so drawing itself is not exercised here.
describe("SearchDrawPad focus management", () => {
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
  };
  let getContext: jest.SpyInstance;
  let nextBlob: Blob | null;

  beforeAll(() => {
    globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
      configurable: true,
      value: jest.fn(),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    nextBlob = new Blob(["drawing"], { type: "image/png" });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => callback(nextBlob),
    });
  });

  afterEach(() => getContext.mockRestore());

  it("moves focus into the dialog on open", () => {
    render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("restores focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Draw to search";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("closes when the native dialog is cancelled", () => {
    const onCancel = jest.fn();
    render(<SearchDrawPad onCancel={onCancel} onSubmit={jest.fn()} />);

    fireEvent(
      screen.getByRole("dialog", { name: "Draw to search" }),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not restore focus to an opener that was removed", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);
    trigger.remove();

    unmount();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("opens safely when the document has no HTML focus owner", () => {
    const activeElement = jest.spyOn(document, "activeElement", "get").mockReturnValue(null);
    try {
      const { unmount } = render(<SearchDrawPad onCancel={jest.fn()} onSubmit={jest.fn()} />);
      unmount();
    } finally {
      activeElement.mockRestore();
    }
  });

  it("dismisses only direct backdrop clicks", () => {
    const onCancel = jest.fn();
    render(<SearchDrawPad onCancel={onCancel} onSubmit={jest.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Draw to search" });
    const panel = dialog.firstElementChild!;

    fireEvent.click(panel);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("draws with the selected brush, submits PNG data, and clears the canvas", () => {
    const onSubmit = jest.fn();
    const { container } = render(<SearchDrawPad onCancel={jest.fn()} onSubmit={onSubmit} />);
    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 224, height: 224, right: 234, bottom: 244 }) as DOMRect;
    const search = screen.getByRole("button", { name: "Search" }) as HTMLButtonElement;

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 448, 448);
    expect(search.disabled).toBe(true);
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 30, pointerId: 1 });
    expect(context.stroke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Brush colour #d33d2e" }));
    fireEvent.click(screen.getByRole("button", { name: "Broad" }));
    fireEvent.pointerDown(canvas, { clientX: 66, clientY: 76, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 122, clientY: 132, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 150, pointerId: 1 });

    expect(context.strokeStyle).toBe("#d33d2e");
    expect(context.lineWidth).toBe(34);
    expect(context.lineCap).toBe("round");
    expect(context.lineJoin).toBe("round");
    expect(context.moveTo).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
    expect(search.disabled).toBe(false);

    fireEvent.click(search);
    expect(onSubmit).toHaveBeenCalledWith(nextBlob);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(search.disabled).toBe(true);

    fireEvent.pointerDown(canvas, { clientX: 30, clientY: 30, pointerId: 2 });
    fireEvent.pointerCancel(canvas, { pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 2 });
  });

  it("guards absent canvas contexts and ignores a null encoded blob", () => {
    getContext.mockReturnValue(null);
    const onSubmit = jest.fn();
    const { container, rerender } = render(
      <SearchDrawPad onCancel={jest.fn()} onSubmit={onSubmit} />,
    );
    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }) as DOMRect;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    getContext.mockReturnValue(context as unknown as CanvasRenderingContext2D);
    rerender(<SearchDrawPad onCancel={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 4 });
    fireEvent.pointerUp(canvas, { pointerId: 4 });
    nextBlob = null;
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
