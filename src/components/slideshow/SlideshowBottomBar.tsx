import React from "react";
import styles from "../../pages/slideshow/slideshow.module.css";
import MMap from "../Map";
import { RandomPhotoRow } from "../search/api";
import { DetailsAlignment } from "../../util/slideshowUrl";
import {
  describeRemix,
  getRemixSwatchRgb,
  getTimeAffinityScore,
  RemixStrategy,
} from "../../util/slideshowAmbient";
import {
  extractDateFromExifString,
  extractGPSFromExifString,
} from "../../util/extractExifFromDb";
import { getRelativeTimeString } from "../../util/time";

// Stable references for the slide map's style props so the memoised MMap can
// skip re-rendering when only the coordinates are unchanged.
const SLIDE_MAP_STYLE = { width: "100%", height: "100%" } as const;
const SLIDE_MARKER_STYLE = { visibility: "hidden" } as const;

const REMIX_STRATEGY_LABEL: Record<RemixStrategy, string> = {
  "same-album": "from this album",
  "same-year": "from the same year",
  "same-decade": "from the same decade",
  "same-region": "from the same region",
  "same-country": "from the same country",
  "same-city": "from the same city",
  "same-day-of-year": "from this exact date, other years",
  "dominant-colour": "sharing this colour",
  anniversary: "from this week, other years",
  proximity: "shot nearby",
  "golden-hour": "shot at golden hour",
  juxtapose: "deliberately juxtaposed",
  "shared-camera": "shot through the same lens",
  similar: "visually similar",
  random: "picked at random",
};

const extractGeocodeLabel = (geocode: string): string | null =>
  geocode
    ? geocode
        .split("\n")
        .slice(-3)
        .filter((x) => Number.isNaN(parseFloat(x)))
        .join(", ") || null
    : null;

// Cosine similarity from SigLIP is almost always in [0, 1] for normalised image
// embeddings, but the contract isn't strictly bounded — clamp before rounding
// so a stray negative score can't render as "105% distance".
const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value * 100)));

// The slide's bottom overlay: per-photo descriptions + slide-level chrome
// (map, clock, remix badge). Dual-rendered so mix-blend-mode applies to the
// map only while the text keeps its drop-shadow (see the layer comments below).
export type SlideshowBottomBarProps = {
  // Seed photo plus any remix companions, in render order.
  slidePhotos: RandomPhotoRow[];
  showDetails: boolean;
  showMap: boolean;
  showClock: boolean;
  timeAware: boolean;
  detailsAlignment: DetailsAlignment;
  remixStrategy: RemixStrategy | null;
  remixVectorScore: number | null;
  time: Date;
};

export const SlideshowBottomBar: React.FC<SlideshowBottomBarProps> = (props) => {
  const { slidePhotos, remixStrategy } = props;

  // Per-photo metadata for the whole slide (seed + any remix companions).
  const slidePhotoMeta = slidePhotos.map((photo) => ({
    path: photo.path,
    date: extractDateFromExifString(photo.exif),
    geocode: extractGeocodeLabel(photo.geocode),
    coords: extractGPSFromExifString(photo.exif),
  }));

  // Per-photo description: geocode + date + (optionally) the time-affinity row.
  // No chrome (map / clock / strategy badge) — those are slide-level, below.
  const renderPhotoDescription = (meta: (typeof slidePhotoMeta)[number]) => {
    const photoDate = meta.date;
    const photoGeocode = meta.geocode;
    const photoRelative = photoDate ? getRelativeTimeString(photoDate) : null;

    return (
      <div
        className={[
          styles.details,
          styles.displaySetting,
          props.showDetails ? styles.displaySettingActive : "",
        ].join(" ")}
      >
        {photoGeocode ? (
          <div className={styles.detailsRow}>{photoGeocode}</div>
        ) : (
          <div className={styles.detailsRow}>&nbsp;</div>
        )}

        {photoDate ? (
          <div className={styles.detailsRow}>
            {photoRelative ? `${photoRelative} · ` : ""}
            {photoDate.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
            })}
          </div>
        ) : (
          <div className={styles.detailsRow}>&nbsp;</div>
        )}

        {props.timeAware && photoDate ? (
          <div className={[styles.detailsRow, styles.detailsAffinity].join(" ")}>
            🌅 {Math.round(getTimeAffinityScore(photoDate) * 100)}% match
          </div>
        ) : null}
      </div>
    );
  };

  // Map zone. The heavy WebGL MMap is only mounted on the blend layer
  // (mountMap), halving per-slide WebGL context lifecycles on a long session.
  const renderSlideMap = (mountMap: boolean) => {
    const allCoords = slidePhotoMeta
      .map((m) => m.coords)
      .filter((c): c is [number, number] => !!c);
    if (allCoords.length === 0) return null;
    return (
      <div
        className={[
          styles.mapContainer,
          styles.displaySetting,
          props.showMap ? styles.displaySettingActive : "",
        ].join(" ")}
        style={{ mixBlendMode: "screen" }}
      >
        {mountMap ? (
          <MMap
            coordinates={allCoords.length === 1 ? allCoords[0] : allCoords}
            attribution={false}
            details={false}
            style={SLIDE_MAP_STYLE}
            mapStyle="toner-v2"
            projection="vertical-perspective"
            markerStyle={SLIDE_MARKER_STYLE}
          />
        ) : null}
      </div>
    );
  };

  // Clock zone, optionally with the remix strategy badge above the time/date.
  const renderSlideClock = () => {
    const isRemix = slidePhotos.length > 1;
    const remixDescriptor =
      isRemix && remixStrategy ? describeRemix(remixStrategy, slidePhotos) : null;
    const remixSwatch =
      isRemix && remixStrategy
        ? getRemixSwatchRgb(remixStrategy, slidePhotos)
        : null;
    const vectorScoreLabel =
      isRemix &&
      (remixStrategy === "similar" || remixStrategy === "juxtapose") &&
      props.remixVectorScore !== null
        ? remixStrategy === "similar"
          ? `${clampPercent(props.remixVectorScore)}% match`
          : // For juxtapose the cosine is low; surface it as a "distance"
            // reading so the framing matches the strategy intent.
            `${clampPercent(1 - props.remixVectorScore)}% distance`
        : null;
    return (
      <>
        {isRemix && remixStrategy ? (
          <div className={[styles.detailsRow, styles.detailsAffinity].join(" ")}>
            ◫ Remix · {slidePhotos.length} photos{" "}
            {REMIX_STRATEGY_LABEL[remixStrategy]}
            {remixSwatch ? (
              <>
                {" "}
                <span
                  className={styles.remixSwatch}
                  aria-hidden="true"
                  style={{
                    backgroundColor: `rgb(${remixSwatch[0]}, ${remixSwatch[1]}, ${remixSwatch[2]})`,
                  }}
                />
              </>
            ) : null}
            {remixDescriptor ? ` · ${remixDescriptor}` : ""}
            {vectorScoreLabel ? ` · ${vectorScoreLabel}` : ""}
          </div>
        ) : null}

        <div
          className={[
            styles.clock,
            styles.displaySetting,
            props.showClock ? styles.displaySettingActive : "",
          ].join(" ")}
        >
          <div className={styles.time}>
            {props.time.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "numeric",
              hour12: false,
            })}
          </div>
          <div className={styles.date}>
            {props.time.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </>
    );
  };

  // Dual-rendered stack. Both copies share the same fixed position and layout
  // (every grid-area present) so they overlay pixel-for-pixel. Layer 1 has
  // mix-blend-mode: screen and shows ONLY the map (other cells hidden but still
  // occupying layout); Layer 2 has no blending and shows the text/clock with
  // their full text-shadow. Net: map blends with the photo, text stays sharp.
  return (
    <>
      {[true, false].map((isMapLayer) => (
        <div
          key={isMapLayer ? "map" : "text"}
          className={styles.bottomBarStack}
          data-count={slidePhotos.length}
          data-align={props.detailsAlignment}
          style={isMapLayer ? { mixBlendMode: "screen" } : undefined}
        >
          <div
            className={styles.slideMap}
            style={{
              gridArea: "map",
              visibility: isMapLayer ? "visible" : "hidden",
            }}
          >
            {renderSlideMap(isMapLayer)}
          </div>
          {slidePhotos.map((photo, idx) => (
            <div
              key={`${photo.path}-${idx}`}
              className={styles.descriptionCell}
              style={{
                gridArea: `desc${idx}`,
                visibility: isMapLayer ? "hidden" : "visible",
              }}
            >
              {renderPhotoDescription(slidePhotoMeta[idx])}
            </div>
          ))}
          <div
            className={styles.slideClock}
            style={{
              gridArea: "clock",
              visibility: isMapLayer ? "hidden" : "visible",
            }}
          >
            {renderSlideClock()}
          </div>
        </div>
      ))}
    </>
  );
};
