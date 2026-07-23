import React from "react";
import { createPortal } from "react-dom";
import { gl } from "./engine";
import type { GlMarker, MarkerOptions } from "./engine";
import { useAttachedMap } from "./context";

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

const applyStyle = (element: HTMLElement, style: React.CSSProperties | undefined) => {
  if (!style) {
    return;
  }

  Object.assign(element.style, style);
};

const MarkerImpl = (
  props: MarkerProps,
  ref: React.ForwardedRef<GlMarker | null>,
): React.JSX.Element | null => {
  const map = useAttachedMap();
  const propsRef = React.useRef(props);
  propsRef.current = props;

  // Built once: the element is a stable portal target, and MarkerOptions other
  // than the position are constant at every call site in this repo.
  const marker = React.useMemo(() => {
    const initial = propsRef.current;
    const options: MarkerOptions = { ...initial };
    if (hasRenderableChildren(initial.children)) {
      options.element = document.createElement("div");
    }

    const instance = new gl.Marker(options);
    instance.setLngLat([initial.longitude, initial.latitude]);
    instance.getElement().addEventListener("click", (event: MouseEvent) => {
      propsRef.current.onClick?.({ type: "click", target: instance, originalEvent: event });
    });

    return instance;
  }, []);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    marker.addTo(map);

    return () => {
      marker.remove();
    };
  }, [map, marker]);

  const { longitude, latitude, style } = props;

  React.useEffect(() => {
    const position = marker.getLngLat();
    if (position.lng !== longitude || position.lat !== latitude) {
      marker.setLngLat([longitude, latitude]);
    }
  }, [marker, longitude, latitude]);

  React.useEffect(() => {
    applyStyle(marker.getElement(), style);
  }, [marker, style]);

  React.useImperativeHandle(ref, () => marker, [marker]);

  if (!map) {
    return null;
  }

  return createPortal(props.children, marker.getElement());
};

export const Marker = React.memo(React.forwardRef(MarkerImpl));
