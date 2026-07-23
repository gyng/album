import React from "react";
import { useMap } from "./map/adapters/maplibre";
import type { MapWorldEntry } from "../util/pageDataTypes";

const DIRECTOR_CADENCE_MS = 7_500;
const DIRECTOR_FLIGHT_MS = 4_600;

export const MapDirector = ({
  enabled,
  sequence,
  onVisit,
}: {
  enabled: boolean;
  sequence: MapWorldEntry[];
  onVisit: (photo: MapWorldEntry) => void;
}) => {
  const { current: map } = useMap();

  React.useEffect(() => {
    if (!enabled || !map || sequence.length === 0) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let index = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const visit = () => {
      const photo = sequence[index % sequence.length];
      if (!photo || photo.decLat === null || photo.decLng === null) {
        return;
      }
      onVisit(photo);
      map.flyTo({
        center: [photo.decLng, photo.decLat],
        zoom: index % 3 === 0 ? 6.2 : 8.4,
        pitch: reduceMotion ? 0 : 42,
        bearing: reduceMotion ? 0 : ((index * 53 + 18) % 240) - 120,
        duration: reduceMotion ? 0 : DIRECTOR_FLIGHT_MS,
      });
      index += 1;
      timer = setTimeout(visit, DIRECTOR_CADENCE_MS);
    };

    visit();
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      map.stop();
    };
  }, [enabled, map, onVisit, sequence]);

  return null;
};
