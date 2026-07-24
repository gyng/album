import { Popup } from "./map";
import { buildExternalMapLinks } from "./mapInteractions";
import styles from "./MapWorld.module.css";

export type MapContextPoint = { latitude: number; longitude: number };

export const MapContextMenu = ({
  point,
  onClose,
  onInteractionStart,
}: {
  point: MapContextPoint | null;
  onClose: () => void;
  onInteractionStart: () => void;
}) => {
  if (!point) {
    return null;
  }

  const links = buildExternalMapLinks(point.latitude, point.longitude);

  return (
    <Popup
      at={{ lng: point.longitude, lat: point.latitude }}
      // No close button and no click-away of its own: the map dismisses this
      // menu itself, so the popup does not need a second way to shut.
      offset={8}
      onDismiss={onClose}
      {...(styles.contextPopup ? { className: styles.contextPopup } : {})}
    >
      <div className={styles.contextMenu} role="group" aria-label="Location actions">
        <strong className={styles.contextHeading}>Location</strong>
        <span className={styles.contextCoordinates}>
          {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
        </span>
        <a
          href={links.google}
          target="_blank"
          rel="noreferrer"
          onMouseDownCapture={onInteractionStart}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          Open in Google Maps <span aria-hidden="true">↗</span>
        </a>
        <a
          href={links.osm}
          target="_blank"
          rel="noreferrer"
          onMouseDownCapture={onInteractionStart}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          Open in OpenStreetMap <span aria-hidden="true">↗</span>
        </a>
      </div>
    </Popup>
  );
};
