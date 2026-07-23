import React from "react";
import { createPortal } from "react-dom";
import { gl } from "./engine";
import type { GlPopup, PopupOptions } from "./engine";
import { useAttachedMap } from "./context";
import { deepEqual } from "./internal";

export type PopupEvent = {
  type: "open" | "close";
  target: GlPopup;
};

export type PopupProps = PopupOptions & {
  /** Longitude of the anchor location. */
  longitude: number;
  /** Latitude of the anchor location. */
  latitude: number;
  onOpen?: (event: PopupEvent) => void;
  onClose?: (event: PopupEvent) => void;
  children?: React.ReactNode;
};

const PopupImpl = (
  props: PopupProps,
  ref: React.ForwardedRef<GlPopup | null>,
): React.JSX.Element | null => {
  const map = useAttachedMap();
  const propsRef = React.useRef(props);
  const previousPropsRef = React.useRef(props);
  propsRef.current = props;

  // A stable container the popup renders through, so React owns the content and
  // MapLibre owns the positioning.
  const container = React.useMemo(() => document.createElement("div"), []);
  const popup = React.useMemo(() => {
    const initial = propsRef.current;
    const instance = new gl.Popup({ ...initial });
    instance.setLngLat([initial.longitude, initial.latitude]);

    return instance;
  }, []);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const onOpen = () => {
      propsRef.current.onOpen?.({ type: "open", target: popup });
    };
    const onClose = () => {
      propsRef.current.onClose?.({ type: "close", target: popup });
    };

    popup.on("open", onOpen);
    popup.on("close", onClose);
    popup.setDOMContent(container).addTo(map);

    return () => {
      // Unmounting is not a user-driven close, so the callback is detached
      // before removal — otherwise a StrictMode remount reports a false close.
      popup.off("open", onOpen);
      popup.off("close", onClose);
      if (popup.isOpen()) {
        popup.remove();
      }
    };
  }, [map, popup, container]);

  React.useImperativeHandle(ref, () => popup, [popup]);

  const { longitude, latitude, offset, maxWidth, className } = props;

  // `anchor` is a construction-time option here — no call site changes it after
  // mount, and MapLibre only reads it while placing an open popup.
  React.useEffect(() => {
    if (!popup.isOpen()) {
      return;
    }

    const previous = previousPropsRef.current;
    const position = popup.getLngLat();
    if (position.lng !== longitude || position.lat !== latitude) {
      popup.setLngLat([longitude, latitude]);
    }
    if (offset !== undefined && !deepEqual(previous.offset, offset)) {
      popup.setOffset(offset);
    }
    if (maxWidth !== undefined && previous.maxWidth !== maxWidth) {
      popup.setMaxWidth(maxWidth);
    }
    if (previous.className !== className) {
      for (const name of (previous.className ?? "").split(" ").filter(Boolean)) {
        popup.removeClassName(name);
      }
      for (const name of (className ?? "").split(" ").filter(Boolean)) {
        popup.addClassName(name);
      }
    }

    previousPropsRef.current = propsRef.current;
  }, [popup, longitude, latitude, offset, maxWidth, className]);

  if (!map) {
    return null;
  }

  return createPortal(props.children, container);
};

export const Popup = React.memo(React.forwardRef(PopupImpl));
