import Link from "next/link";
import { Popup } from "react-map-gl/maplibre";
import { exifWallClockTimestamp } from "../util/exifTime";
import { getRelativeTimeString } from "../util/time";
import type { MapWorldEntry } from "./MapWorld";
import { formatMapPhotoDateTime } from "./mapWorldViewModel";
import { buildExternalMapLinks } from "./mapInteractions";
import styles from "./MapWorld.module.css";

type MapPhotoPopupProps = {
  photo: MapWorldEntry | null;
  selected: boolean;
  onClose: () => void;
  onInteractionStart: () => void;
};

export const MapPhotoPopup = ({
  photo,
  selected,
  onClose,
  onInteractionStart,
}: MapPhotoPopupProps) => {
  if (!photo || photo.decLat === null || photo.decLng === null) {
    return null;
  }

  const formattedDate = formatMapPhotoDateTime(photo.date);
  const timestamp = exifWallClockTimestamp(photo.date);
  const relative = timestamp === null ? null : getRelativeTimeString(new Date(timestamp));
  const mapLinks = buildExternalMapLinks(photo.decLat, photo.decLng);

  return (
    <Popup
      longitude={photo.decLng}
      latitude={photo.decLat}
      onClose={onClose}
      className={`${styles.popup} ${selected ? styles.click : styles.hover}`}
      offset={15}
      closeButton={false}
    >
      {/* This is event plumbing, not an interactive control. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onMouseDownCapture={onInteractionStart}
        onTouchStartCapture={onInteractionStart}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <Link href={photo.href} className={styles.link}>
          <img
            src={photo.src.src}
            className={styles.image}
            width={photo.placeholderWidth}
            height={photo.placeholderHeight}
            style={{ backgroundColor: photo.placeholderColor }}
            alt={photo.album}
          />
          <div className={styles.details}>
            {photo.album}
            {formattedDate && timestamp !== null ? (
              <>
                <br />
                <span>
                  {formattedDate}
                  {relative ? (
                    <>
                      <br />
                      {relative}
                    </>
                  ) : null}
                </span>
              </>
            ) : null}
          </div>
        </Link>

        {selected ? (
          <div className={styles.viewOn}>
            <a href={mapLinks.google} target="_blank" rel="noreferrer">
              Open in Google Maps
            </a>
            &nbsp;&middot;&nbsp;
            <a href={mapLinks.osm} target="_blank" rel="noreferrer">
              Open in OpenStreetMap
            </a>
          </div>
        ) : null}
      </div>
    </Popup>
  );
};
