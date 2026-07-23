import React from "react";
import type { AddLayerObject, FilterSpecification, LayerSpecification } from "./engine";
import { SourceIdContext, useAttachedMap } from "./context";
import { deepEqual, isStyleUsable, useGeneratedId, useStyleVersion } from "./internal";

type OptionalId<T> = T extends { id: string } ? Omit<T, "id"> & { id?: string } : T;
type OptionalSource<T> = T extends { source: string } ? Omit<T, "source"> & { source?: string } : T;

export type LayerProps = OptionalSource<OptionalId<LayerSpecification>> & {
  /** If set, the layer is inserted before the named layer. */
  beforeId?: string;
};

/**
 * The subset of a layer spec this adapter reads. Layer specs are a wide union,
 * and consumers spread raw style-spec objects in, so they are read through one
 * structural view rather than narrowed member by member.
 */
type LayerView = {
  id?: string;
  source?: string;
  beforeId?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: FilterSpecification;
  minzoom?: number;
  maxzoom?: number;
};

const asLayerView = (props: LayerProps): LayerView => props as unknown as LayerView;

const toAddLayerObject = (props: LayerProps, id: string, source: string | null): AddLayerObject => {
  const spec: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(props)) {
    if (key !== "id" && key !== "beforeId") {
      spec[key] = value;
    }
  }
  if (spec.source === undefined && source !== null) {
    spec.source = source;
  }

  return spec as unknown as AddLayerObject;
};

export const Layer = (props: LayerProps): null => {
  const map = useAttachedMap();
  const styleVersion = useStyleVersion(map);
  const view = asLayerView(props);
  const id = useGeneratedId("jsx-layer", view.id);
  const sourceId = React.useContext(SourceIdContext);
  const propsRef = React.useRef(props);
  const previousViewRef = React.useRef(view);

  // Adding is separate from removing: `styleVersion` re-adds a layer that a
  // style reload dropped, but must never tear down a healthy one.
  React.useEffect(() => {
    if (!isStyleUsable(map) || map.getLayer(id)) {
      return;
    }

    const current = propsRef.current;
    const beforeId = asLayerView(current).beforeId;
    map.addLayer(toAddLayerObject(current, id, sourceId), beforeId);
    previousViewRef.current = asLayerView(current);
  }, [map, id, sourceId, styleVersion]);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    return () => {
      // The enclosing <Source> may already have swept this layer away.
      if (isStyleUsable(map) && map.getLayer(id)) {
        map.removeLayer(id);
      }
    };
  }, [map, id]);

  const { paint, layout, filter, minzoom, maxzoom, beforeId } = view;

  React.useEffect(() => {
    propsRef.current = props;

    if (!isStyleUsable(map) || !map.getLayer(id)) {
      return;
    }

    const previous = previousViewRef.current;

    if (beforeId !== previous.beforeId) {
      map.moveLayer(id, beforeId);
    }

    if (layout !== previous.layout) {
      const previousLayout = previous.layout ?? {};
      for (const [key, value] of Object.entries(layout ?? {})) {
        if (!deepEqual(previousLayout[key], value)) {
          map.setLayoutProperty(id, key, value);
        }
      }
      for (const key of Object.keys(previousLayout)) {
        if (!(layout && key in layout)) {
          map.setLayoutProperty(id, key, undefined);
        }
      }
    }

    if (paint !== previous.paint) {
      const previousPaint = previous.paint ?? {};
      for (const [key, value] of Object.entries(paint ?? {})) {
        if (!deepEqual(previousPaint[key], value)) {
          map.setPaintProperty(id, key, value);
        }
      }
      for (const key of Object.keys(previousPaint)) {
        if (!(paint && key in paint)) {
          map.setPaintProperty(id, key, undefined);
        }
      }
    }

    if (!deepEqual(filter, previous.filter)) {
      map.setFilter(id, filter);
    }

    if (minzoom !== previous.minzoom || maxzoom !== previous.maxzoom) {
      // Falls back to the style-spec defaults, which is what clearing a bound means.
      map.setLayerZoomRange(id, minzoom ?? 0, maxzoom ?? 24);
    }

    previousViewRef.current = view;
  });

  return null;
};
