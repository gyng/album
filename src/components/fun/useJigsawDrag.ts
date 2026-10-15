import { useRef, useState, type PointerEvent, type RefObject } from "react";

type Destination = number | "pool";
type Pending = {
  piece: number;
  pointer: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  moved: boolean;
};
export const useJigsawDrag = (
  root: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onDrop: (piece: number, target: Destination) => void,
) => {
  const pending = useRef<Pending | null>(null),
    suppress = useRef(false);
  const [drag, setDrag] = useState<{
    piece: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [over, setOver] = useState<Destination | null>(null);
  const destination = (x: number, y: number): Destination | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-jigsaw-target]");
    if (!hit || !root.current?.contains(hit)) return null;
    const target = hit.dataset.jigsawTarget;
    return target === "pool"
      ? "pool"
      : target !== undefined && Number.isInteger(Number(target))
        ? Number(target)
        : null;
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, piece: number) => {
    if (!enabled || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pending.current = {
      piece,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.x,
      offsetY: event.clientY - rect.y,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    suppress.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = pending.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (
      !current.moved &&
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 7
    )
      return;
    current.moved = true;
    event.preventDefault();
    setDrag({
      piece: current.piece,
      x: event.clientX - current.offsetX,
      y: event.clientY - current.offsetY,
      width: current.width,
      height: current.height,
    });
    setOver(destination(event.clientX, event.clientY));
  };
  const cancel = () => {
    pending.current = null;
    setDrag(null);
    setOver(null);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = pending.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.moved) {
      const target = destination(event.clientX, event.clientY);
      suppress.current = true;
      if (enabled && target !== null) onDrop(current.piece, target);
      window.setTimeout(() => {
        suppress.current = false;
      }, 0);
    }
    cancel();
  };
  const ignoreClick = () => {
    const result = suppress.current;
    suppress.current = false;
    return result;
  };
  return { drag, over, begin, move, end, cancel, ignoreClick };
};
