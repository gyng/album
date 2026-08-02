import { AppLink as Link } from "./platform";
import { Popup } from "./map";
import { exifRelativeTimestamp } from "../util/exifTime";
import { getRelativeTimeString } from "../util/time";
import type { MapWorldEntry } from "../util/pageDataTypes";
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

  const formattedDate = formatMapPhotoDateTime(photo.date, photo.dateOffset);
  const timestamp = exifRelativeTimestamp(photo.date, photo.dateOffset);
  const relative = timestamp === null ? null : getRelativeTimeString(new Date(timestamp));
  const mapLinks = buildExternalMapLinks(photo.decLat, photo.decLng);

  return (
    <Popup
      at={{ lng: photo.decLng, lat: photo.decLat }}
      // Deliberately without the provider's click-away: a pin's own click is the
      // same gesture as the map's, so a popup that dismissed itself on a map
      // click would shut the moment the tap that opened it finished. `MapWorld`
      // owns dismissal instead, where it can tell the two apart.
      className={`${styles.popup} ${selected ? styles.click : styles.hover}`}
      offset={15}
      onDismiss={onClose}
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
            {photo.mediaKind === "video" ? (
              <>
                <span className={styles.mediaKind}>
                  {/* The glyph is decoration; the word is what carries meaning,
                      and a screen reader announcing "black right-pointing
                      triangle" carries none. */}
                  <span aria-hidden="true">▶</span> Video
                </span>
                <br />
              </>
            ) : null}
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
