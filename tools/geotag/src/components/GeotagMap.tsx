import { useEffect, useMemo } from "react";
import Map, {
  Layer,
  Marker,
  Source,
  useMap,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import { computeWrapAwareBounds } from "@shared/mapBounds";
import { mapStyleUrl } from "@shared/mapStyles";
import type { Track } from "@shared/gpsTrack";
import type { GeotagPhoto, PendingFix } from "../api.ts";

// Shares the gallery's configured provider key, so a fork sets it once.
const MAP_STYLE = mapStyleUrl("streets");

export type PendingMarker = { filename: string } & PendingFix;

const pinClass = (m: PendingMarker): string => {
  if (!m.interpolated) return "pin pin--pending";
  if (m.confidence === "high") return "pin pin--high";
  if (m.confidence === "medium") return "pin pin--medium";
  return "pin pin--low";
};

// Re-fit only when the set of existing-GPS photos changes (album switch), never
// while placing/dragging, so the map doesn't jump under the cursor.
const FitBounds = ({ photos }: { photos: GeotagPhoto[] }) => {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map || photos.length === 0) return;
    const coords = photos.map((p) => [p.decLng as number, p.decLat as number] as [number, number]);
    if (coords.length === 1) {
      map.flyTo({ center: coords[0], zoom: 12, duration: 600 });
      return;
    }
    const bounds = computeWrapAwareBounds(coords);
    if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 600 });
  }, [map, photos]);
  return null;
};

export const GeotagMap = ({
  located,
  pending,
  track,
  canPlace,
  onMapClick,
  onPendingDrag,
}: {
  located: GeotagPhoto[];
  pending: PendingMarker[];
  track: Track | null;
  canPlace: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onPendingDrag: (filename: string, lat: number, lng: number) => void;
}) => {
  const center = located[0]
    ? { longitude: located[0].decLng as number, latitude: located[0].decLat as number, zoom: 10 }
    : pending[0]
      ? { longitude: pending[0].lng, latitude: pending[0].lat, zoom: 10 }
      : { longitude: 0, latitude: 20, zoom: 1.4 };

  const trackGeoJson = useMemo(() => {
    if (!track || track.points.length < 2) return null;
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: track.points.map((p) => [p.lng, p.lat]),
          },
          properties: {},
        },
      ],
    };
  }, [track]);

  return (
    <Map
      mapStyle={MAP_STYLE}
      initialViewState={center}
      style={{ width: "100%", height: "100%" }}
      cursor={canPlace ? "crosshair" : "grab"}
      attributionControl={{ compact: true }}
      onClick={(e: MapLayerMouseEvent) => {
        if (canPlace) onMapClick(e.lngLat.lat, e.lngLat.lng);
      }}
    >
      {trackGeoJson ? (
        <Source id="track" type="geojson" data={trackGeoJson}>
          <Layer
            id="track-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#4ea1ff", "line-width": 2, "line-opacity": 0.65 }}
          />
        </Source>
      ) : null}

      {located.map((p) => (
        <Marker
          key={`loc-${p.filename}`}
          longitude={p.decLng as number}
          latitude={p.decLat as number}
          anchor="center"
        >
          <span className="pin pin--located" title={p.filename} />
        </Marker>
      ))}

      {pending.map((m) => (
        <Marker
          key={`pend-${m.filename}`}
          longitude={m.lng}
          latitude={m.lat}
          anchor="center"
          draggable
          onDragEnd={(e) => onPendingDrag(m.filename, e.lngLat.lat, e.lngLat.lng)}
        >
          <span
            className={pinClass(m)}
            title={`${m.filename}${m.interpolated ? ` (${m.confidence} confidence)` : ""} — drag to adjust`}
          />
        </Marker>
      ))}

      <FitBounds photos={located} />
    </Map>
  );
};
