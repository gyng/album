import React from "react";
import { createPortal } from "react-dom";
import { gl } from "./engine";
import type { GlMarker, MarkerOptions } from "./engine";
import { useAttachedMap } from "./context";
import { deepEqual, useLatestRef } from "./internal";

export type MarkerEvent<OriginalEventT = undefined> = {
  type: string;
  target: GlMarker;
  originalEvent: OriginalEventT;
};

export type MarkerProps = MarkerOptions & {
  /** Longitude of the anchor location. */
  longitude: number;
  /** Latitude of the anchor location. */
  latitude: number;
  /** CSS style override, applied to the marker element. */
  style?: React.CSSProperties;
  onClick?: (event: MarkerEvent<MouseEvent>) => void;
  children?: React.ReactNode;
};

const hasRenderableChildren = (children: React.ReactNode): boolean => {
  let found = false;
  React.Children.forEach(children, (child) => {
    if (child) {
      found = true;
    }
  });

  return found;
};

/** `backgroundColor` → `background-color`; custom properties pass straight through. */
const toCssPropertyName = (key: string): string =>
  key.startsWith("--") ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * Applies the `style` prop as a replacement rather than an addition. Only the
 * properties this component set last time are cleared: MapLibre writes its own
 * `transform`, `opacity` and `pointer-events` onto the very same element, and
 * wiping the whole declaration would undo the marker's positioning.
 */
const applyStyle = (
  element: HTMLElement,
  style: React.CSSProperties | undefined,
  previous: React.CSSProperties | undefined,
): void => {
  for (const key of Object.keys(previous ?? {})) {
    if (!style || !(key in style)) {
      element.style.removeProperty(toCssPropertyName(key));
    }
  }

  if (style) {
    Object.assign(element.style, style);
  }
};

/**
 * The options MapLibre bakes into a marker when it constructs one. There is no
 * setter for any of them — `element` least of all, since whether we pass one
 * decides between our portal target and MapLibre's default SVG pin — so a
 * change to any of them means building a new marker.
 */
const structuralSignature = (props: MarkerProps): string =>
  JSON.stringify([
    props.anchor ?? null,
    props.color ?? null,
    props.scale ?? null,
    props.clickTolerance ?? null,
    props.element ? "caller" : hasRenderableChildren(props.children) ? "portal" : "default",
  ]);

/** The options MapLibre can change on a live marker. */
const applySettableOptions = (
  marker: GlMarker,
  props: MarkerProps,
  previous: MarkerProps,
): void => {
  if (props.offset !== undefined && !deepEqual(props.offset, previous.offset)) {
    marker.setOffset(props.offset);
  }
  if (props.draggable !== previous.draggable) {
    marker.setDraggable(props.draggable ?? false);
  }
  if (props.rotation !== previous.rotation) {
    marker.setRotation(props.rotation ?? 0);
  }
  if (props.rotationAlignment !== previous.rotationAlignment) {
    marker.setRotationAlignment(props.rotationAlignment ?? "auto");
  }
  if (props.pitchAlignment !== previous.pitchAlignment) {
    marker.setPitchAlignment(props.pitchAlignment ?? "auto");
  }
  if (props.subpixelPositioning !== previous.subpixelPositioning) {
    marker.setSubpixelPositioning(props.subpixelPositioning ?? false);
  }
  if (
    props.opacity !== previous.opacity ||
    props.opacityWhenCovered !== previous.opacityWhenCovered
  ) {
    marker.setOpacity(props.opacity, props.opacityWhenCovered);
  }
  if (props.className !== previous.className) {
    for (const name of (previous.className ?? "").split(" ").filter(Boolean)) {
      marker.removeClassName(name);
    }
    for (const name of (props.className ?? "").split(" ").filter(Boolean)) {
      marker.addClassName(name);
    }
  }
};

const createMarker = (props: MarkerProps, propsRef: React.RefObject<MarkerProps>): GlMarker => {
  const options: MarkerOptions = { ...props };
  // Without children there is nothing to portal, so MapLibre draws its own pin.
  if (options.element === undefined && hasRenderableChildren(props.children)) {
    options.element = document.createElement("div");
  }

  const instance = new gl.Marker(options);
  instance.setLngLat([props.longitude, props.latitude]);
  instance.getElement().addEventListener("click", (event: MouseEvent) => {
    propsRef.current.onClick?.({ type: "click", target: instance, originalEvent: event });
  });

  return instance;
};

const MarkerImpl = (
  props: MarkerProps,
  ref: React.ForwardedRef<GlMarker | null>,
): React.JSX.Element | null => {
  const propsRef = useLatestRef(props);
  const map = useAttachedMap();
  // Held in state, not a memo: a change to an option MapLibre only reads at
  // construction has to produce a new marker, and the portal has to follow it
  // to the new element.
  const [marker, setMarker] = React.useState<GlMarker>(() => createMarker(props, propsRef));
  // The props the live marker was built and last reconciled from; null until the
  // first pass, because the constructor already applied everything but `style`.
  const appliedRef = React.useRef<MarkerProps | null>(null);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    marker.addTo(map);

    return () => {
      marker.remove();
    };
  }, [map, marker]);

  const { longitude, latitude } = props;

  React.useEffect(() => {
    const position = marker.getLngLat();
    if (position.lng !== longitude || position.lat !== latitude) {
      marker.setLngLat([longitude, latitude]);
    }
  }, [marker, longitude, latitude]);

  // `props` in the dependencies means "after every render", stated explicitly:
  // any of the reconciled options can change without another signal that it did,
  // and `React.memo` already keeps that down to renders where a prop moved.
  React.useEffect(() => {
    const previous = appliedRef.current;
    appliedRef.current = props;

    if (previous === null) {
      // Straight off the constructor: only `style` is left to apply.
      applyStyle(marker.getElement(), props.style, undefined);

      return;
    }

    if (structuralSignature(props) !== structuralSignature(previous)) {
      // The old marker is left attached until React commits the replacement;
      // the effect above then swaps them in one flush, before paint.
      const replacement = createMarker(props, propsRef);
      applyStyle(replacement.getElement(), props.style, undefined);
      setMarker(replacement);

      return;
    }

    applySettableOptions(marker, props, previous);
    applyStyle(marker.getElement(), props.style, previous.style);
  }, [marker, props, propsRef]);

  React.useImperativeHandle(ref, () => marker, [marker]);

  if (!map) {
    return null;
  }

  return createPortal(props.children, marker.getElement());
};

export const Marker = React.memo(React.forwardRef(MarkerImpl));
