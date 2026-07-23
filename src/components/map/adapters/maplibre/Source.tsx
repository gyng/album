import React from "react";
import { gl } from "./engine";
import type { SourceSpecification } from "./engine";
import { SourceIdContext, useAttachedMap } from "./context";
import { isStyleUsable, useGeneratedId, useStyleVersion } from "./internal";

export type SourceProps = SourceSpecification & {
  id?: string;
  children?: React.ReactNode;
};

/** Everything except the props this adapter adds is the style-spec source. */
const toSourceSpec = (props: SourceProps): SourceSpecification => {
  const spec: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key !== "id" && key !== "children") {
      spec[key] = value;
    }
  }

  return spec as unknown as SourceSpecification;
};

export const Source = (props: SourceProps): React.JSX.Element | null => {
  const map = useAttachedMap();
  const styleVersion = useStyleVersion(map);
  const id = useGeneratedId("jsx-source", props.id);
  const propsRef = React.useRef(props);
  propsRef.current = props;
  const [attached, setAttached] = React.useState(false);

  // Adding is separate from removing: `styleVersion` re-adds a source that a
  // style reload dropped, but must never tear down a healthy one.
  React.useEffect(() => {
    if (!isStyleUsable(map)) {
      return;
    }

    if (!map.getSource(id)) {
      map.addSource(id, toSourceSpec(propsRef.current));
    }
    setAttached(true);
  }, [map, id, styleVersion]);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    return () => {
      setAttached(false);
      if (!isStyleUsable(map) || !map.getSource(id)) {
        return;
      }

      // React destroys this effect before the child layers', so the layers
      // still using the source have to go first.
      for (const layer of map.getStyle().layers) {
        if ("source" in layer && layer.source === id) {
          map.removeLayer(layer.id);
        }
      }
      map.removeSource(id);
    };
  }, [map, id]);

  const data = props.type === "geojson" ? props.data : null;

  React.useEffect(() => {
    if (!attached || !isStyleUsable(map) || data === null) {
      return;
    }

    const source = map.getSource(id);
    if (source instanceof gl.GeoJSONSource) {
      // MapLibre 6 made `setData` asynchronous (it no longer returns the source
      // to chain off). Load failures are reported through the map's own `error`
      // event rather than by rejecting, so there is nothing here to await or
      // recover from — the catch only stops a rejection escaping the effect.
      source.setData(data).catch((error: unknown) => {
        console.error(error);
      });
    }
  }, [attached, map, id, data]);

  // Layers are mounted only once the source exists, so their own effects — which
  // React runs after this one — can always find it.
  if (!attached) {
    return null;
  }

  return <SourceIdContext.Provider value={id}>{props.children}</SourceIdContext.Provider>;
};
