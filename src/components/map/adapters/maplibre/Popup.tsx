import React from "react";
import { createPortal } from "react-dom";
import { gl } from "./engine";
import type { GlPopup, PopupOptions } from "./engine";
import { useAttachedMap } from "./context";
import { deepEqual, useLatestRef } from "./internal";

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
  const propsRef = useLatestRef(props);
  const map = useAttachedMap();
  const previousPropsRef = React.useRef(props);

  // A stable container the popup renders through, so React owns the content and
  // MapLibre owns the positioning.
  const container = React.useMemo(() => document.createElement("div"), []);
  const [popup] = React.useState<GlPopup>(() => {
    // MapLibre moves focus into a popup as it opens — `focusAfterOpen` defaults
    // to true, and `addTo` focuses the first focusable element it finds. Nothing
    // here opens a popup the way a dialog is opened: a popup appears because
    // something *else* was hovered or focused, so taking focus off that thing is
    // never what the reader asked for. It is also self-defeating — the control
    // that opened the popup blurs, the state holding the popup open goes with it,
    // the popup unmounts, and focus ends up on `<body>`. A keyboard reader
    // cannot get past the first item in a list of pins that way.
    //
    // Defaulted here rather than at the port or per consumer: the port describes
    // a popup as something its opener owns and says nothing about focus, so this
    // is the adapter holding the provider to the port's contract rather than
    // every caller separately remembering to. The adapter's props are MapLibre's
    // own options, so a caller that genuinely wants the provider's behaviour can
    // still ask for it by name and win the spread below.
    const instance = new gl.Popup({ focusAfterOpen: false, ...props });
    instance.setLngLat([props.longitude, props.latitude]);

    return instance;
  });

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
  }, [map, popup, container, propsRef]);

  React.useImperativeHandle(ref, () => popup, [popup]);

  const { longitude, latitude, offset, maxWidth, className } = props;

  // `anchor` is a construction-time option here — no call site changes it after
  // mount, and MapLibre only reads it while placing an open popup.
  React.useEffect(() => {
    const previous = previousPropsRef.current;
    const position = popup.getLngLat();
    const moved = position.lng !== longitude || position.lat !== latitude;
    if (moved) {
      popup.setLngLat([longitude, latitude]);
    }

    if (!popup.isOpen()) {
      // MapLibre closes popups behind React's back: `closeOnClick` (on by
      // default), `closeOnMove`, and the close button all call `remove()`
      // themselves. Nothing here re-adds it, so a component whose consumer did
      // not unmount on `onClose` would stay mounted and permanently invisible.
      //
      // Moving the anchor is an unambiguous request for a popup *here*, so that
      // is the one signal that puts it back; a popup dismissed where it stands
      // stays dismissed, and `closeOnClick` still means what it says. Nothing is
      // recorded as applied either, so the pending offset/class differences are
      // still waiting when it does come back.
      if (!moved || !map) {
        return;
      }

      popup.addTo(map);
    }

    // Cleared back to nothing counts as a change, the same as for a marker;
    // MapLibre's popup normalises a missing offset to its own default itself.
    if (!deepEqual(previous.offset, offset)) {
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
  }, [map, popup, longitude, latitude, offset, maxWidth, className, propsRef]);

  if (!map) {
    return null;
  }

  return createPortal(props.children, container);
};

export const Popup = React.memo(React.forwardRef(PopupImpl));
