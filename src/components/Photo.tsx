import Fraction from "fraction.js";
import styles from "./Photo.module.css";
import type { PhotoBlock } from "../services/types";
import { MapDeferred } from "./MapDeferred";
import React from "react";
import { License } from "../License";
import { getDegLatLngFromExif } from "../util/dms2deg";
import { HydratedRelativeTime } from "./HydratedRelativeTime";
import { getPhotoAltText } from "../lib/alt";
import { FacetLinkIcon } from "./FacetLinkIcon";
import { Heading } from "./ui";
import commonStyles from "../styles/common.module.css";

import type { JSX } from "react";
import { rgbToString } from "../util/colorDistance";
import {
  buildSearchFacetHref,
  getBucketFacetSelection,
  getCameraFacetSelection,
  getLensFacetSelection,
  getLocationFacetSelection,
} from "../util/searchFacets";
import {
  APERTURE_FACET,
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  ISO_FACET,
} from "../util/photoBuckets";
import { exifWallClockTimestamp, normaliseExifWallClockIso } from "../util/exifTime";
import { PhotoSimilarPhotosDeferred } from "./PhotoSimilarPhotosDeferred";
import { MediaDetailsIcon } from "./MediaDetailsIcon";

type ExifCoordinatesRowProps = {
  kind: "coordinates";
  /** Display key */
  k: string;
  /** https://exiftool.org/TagNames/GPS.html */
  data: {
    GPSLatitudeRef?: string | undefined;
    GPSLatitude?: [number, number, number] | undefined;
    GPSLongitudeRef?: string | undefined;
    GPSLongitude?: [number, number, number] | undefined;
    geocode?: string | undefined;
  };
  options: {
    showMap: boolean;
    markerColour?: string;
  };
};

const isExifRotated = (block: PhotoBlock): boolean =>
  Boolean(
    block._build.exif.Orientation?.includes("270") || block._build.exif.Orientation?.includes("90"),
  );

const getDisplayDimensions = (block: PhotoBlock): { width: number; height: number } => {
  return isExifRotated(block)
    ? { width: block._build.height, height: block._build.width }
    : { width: block._build.width, height: block._build.height };
};

const ExifCoordinatesRow: React.FC<{ row: ExifCoordinatesRowProps }> = (props) => {
  const locationSelection = getLocationFacetSelection(
    props.row.data.geocode !== undefined ? { geocode: props.row.data.geocode } : {},
  );
  const locationHref = locationSelection ? buildSearchFacetHref(locationSelection) : null;
  const formatted = [
    `${props.row.data.GPSLatitude?.[0]}°`,
    `${props.row.data.GPSLatitude?.[1]}′`,
    props.row.data.GPSLatitude?.[2] ? `${props.row.data.GPSLatitude?.[2].toFixed(0)}″` : null,
    props.row.data.GPSLatitudeRef,
    `${props.row.data.GPSLongitude?.[0]}°`,
    `${props.row.data.GPSLongitude?.[1]}′`,
    props.row.data.GPSLongitude?.[2] ? `${props.row.data.GPSLongitude?.[2].toFixed(0)}″` : null,
    props.row.data.GPSLongitudeRef,
  ]
    .filter(Boolean)
    .join(" ");

  const { decLat, decLng } = getDegLatLngFromExif({
    ...(props.row.data.GPSLongitude !== undefined
      ? { GPSLongitude: props.row.data.GPSLongitude }
      : {}),
    ...(props.row.data.GPSLatitude !== undefined
      ? { GPSLatitude: props.row.data.GPSLatitude }
      : {}),
    ...(props.row.data.GPSLongitudeRef !== undefined
      ? { GPSLongitudeRef: props.row.data.GPSLongitudeRef }
      : {}),
    ...(props.row.data.GPSLatitudeRef !== undefined
      ? { GPSLatitudeRef: props.row.data.GPSLatitudeRef }
      : {}),
  });

  return (
    <>
      <tr>
        <td>{props.row.k}</td>
        <td>
          <span className={styles.detailValueWithAction}>
            <span>{formatted}</span>
            {locationHref ? (
              <FacetLinkIcon href={locationHref} label="Find photos from this place" />
            ) : null}
          </span>
          {props.row.data.geocode ? (
            <div>
              {props.row.data.geocode
                .split("\n")
                .filter((v, i) => i === 1 || i > 4)
                .join(", ")}
            </div>
          ) : null}
        </td>
      </tr>
      {props.row.options.showMap && decLng != null && decLat != null ? (
        <tr>
          {/* Empty layout spacer cell; control-has-associated-label
              false-positives on it (it is not a control). */}
          {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
          <td></td>
          <td>
            <MapDeferred
              coordinates={[decLat, decLng]}
              markerStyle={{
                color: props.row.options.markerColour ?? "var(--c-accent)",
              }}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
};

type ExifRow =
  | {
      kind: "kv";
      /** Display key */
      k: string;
      /** Display value */
      v: ExifCellValue;
      valid?: boolean;
      className?: string | undefined;
    }
  | {
      kind: "coordinates";
      /** Display key */
      k: string;
      /** https://exiftool.org/TagNames/GPS.html */
      v: {
        GPSLatitudeRef?: string | undefined;
        GPSLatitude?: [number, number, number] | undefined;
        GPSLongitudeRef?: string | undefined;
        GPSLongitude?: [number, number, number] | undefined;
        geocode?: string | undefined;
      };
      options: {
        showMap: boolean;
        markerColour?: string;
      };
      valid?: boolean;
    };

type ExifCellValue = string | string[] | number | JSX.Element | JSX.Element[] | undefined | null;

export const PhotoDescription: React.FC<{ description: string }> = (props) => {
  return <div>{props.description}</div>;
};

export const ExifTable: React.FC<{
  rows: ExifRow[];
}> = (props) => {
  return (
    <>
      <table>
        <thead className={styles.th}>
          <tr>
            <td>EXIF key</td>
            <td>Value</td>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            if (row.valid === false) {
              return null;
            }

            switch (row.kind) {
              case "kv":
                // Emptiness check (not truthiness) so a numeric 0 — e.g. an
                // exposure compensation of 0 EV, which is very common — still
                // renders; null/undefined and empty strings stay hidden.
                return row.v != null && row.v !== "" ? (
                  <ExifRow key={row.k} k={row.k} v={row.v} className={row.className} />
                ) : null;
              case "coordinates":
                return (
                  <ExifCoordinatesRow
                    key={row.k}
                    row={{
                      kind: "coordinates",
                      k: "Location",
                      data: row.v,
                      options: row.options,
                    }}
                  />
                );
              default:
                // @ts-expect-error
                throw new Error(`Unsupported type ${row.kind}`);
            }
          })}
        </tbody>
      </table>
    </>
  );
};

export const ExifRow: React.FC<{
  k: string;
  v: ExifCellValue;
  valid?: boolean;
  className?: string | undefined;
}> = (props) => {
  if (props.valid === false) {
    return null;
  }

  return (
    <tr>
      <td>{props.k}</td>
      <td className={props.className}>{props.v}</td>
    </tr>
  );
};

export type PhotoBlockEditDetails = {
  description: string;
};

const THUMBNAIL_MIN_SOURCE_WIDTH = 1600;

const withFacetAction = (
  value: ExifCellValue,
  href: string | null,
  label: string,
): ExifCellValue => {
  if (!href) {
    return value;
  }

  return (
    <span className={styles.detailValueWithAction}>
      <span>{value}</span>
      <FacetLinkIcon href={href} label={label} />
    </span>
  );
};

export const Picture: React.FC<{
  block: PhotoBlock;
  thumb?: boolean;
  lazy?: boolean;
  label?: string;
  useColourPlaceholder?: boolean;
}> = (props) => {
  // Dimensions have to be flipped if image is rotated using EXIF.
  const { width: actualWidth, height: actualHeight } = getDisplayDimensions(props.block);
  const thumbnailSources = props.block._build.srcset.filter(
    ({ width }) => width >= THUMBNAIL_MIN_SOURCE_WIDTH,
  );
  const sources =
    props.thumb && thumbnailSources.length > 0 ? thumbnailSources : props.block._build.srcset;

  const colour = props.block._build.tags.colors?.[0];
  const placeholderColour = colour ? rgbToString(colour) : "transparent";
  // We do this instead of simply setting background-color to `placeholderColor`
  // as using background-color instead fills the entire picture element which can't
  // be sized to be precisely the image size
  // (wide viewports = wide picture element = oversized placeholder overflow)
  const placeholderSvg = `
<svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${actualWidth}" height="${actualHeight}" fill="${placeholderColour}" />
</svg>`;
  const b64Placeholder = btoa(placeholderSvg);

  // The placeholder bleeds outside EXIF-rotated vertical images in some
  // browsers, so those still clear it — but only once decode() resolves, so no
  // frame composites with neither placeholder nor photo (a brief page-background
  // flash otherwise). Unrotated photos keep the placeholder as a permanent
  // backdrop: the photo covers it exactly, and it fills the gap when the
  // browser re-decodes an evicted image while scrolling.
  const clearPlaceholderAfterDecode = (img: HTMLImageElement) => {
    const clear = () => {
      img.style.backgroundImage = "unset";
    };
    if (typeof img.decode === "function") {
      img.decode().then(clear, clear);
    } else {
      clear();
    }
  };

  return (
    // picture is needed for index page, aspect ratio goes all wonky without
    <picture className={styles.imageWrapper}>
      <img
        data-testid="picture"
        className={styles.image}
        srcSet={sources.map((s) => `${s.src} ${s.width}w`).join(", ")}
        sizes={props.thumb ? "auto, 800px" : "auto, 100vw"}
        // Original image is not uploaded
        src={sources[0]?.src}
        loading={props.lazy === false ? "eager" : "lazy"}
        style={{
          aspectRatio: `${actualWidth} / ${actualHeight}`,
          backgroundImage: props.useColourPlaceholder
            ? `url(data:image/svg+xml;base64,${b64Placeholder})`
            : undefined,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          backgroundSize: props.thumb ? "cover" : "contain",
        }}
        {...(isExifRotated(props.block)
          ? {
              onLoad: (evt: React.SyntheticEvent<HTMLImageElement>) =>
                clearPlaceholderAfterDecode(evt.currentTarget),
              // Photos that finish loading before hydration never fire onLoad.
              ref: (img: HTMLImageElement | null) => {
                if (img && img.complete && img.naturalWidth > 0) {
                  clearPlaceholderAfterDecode(img);
                }
              },
            }
          : {})}
        // placeholder image sizes
        width={actualWidth}
        height={actualHeight}
        alt={getPhotoAltText(props.block)}
        aria-label={props.label}
      />
    </picture>
  );
};

export const PhotoBlockEl: React.FC<{
  block: PhotoBlock;
  currentIndex: number;
}> = (props) => {
  const FRACTION_SLASH = "⁄";
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const { exif } = props.block._build;

  const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);
  const cameraSelection = getCameraFacetSelection(exif);
  const lensSelection = getLensFacetSelection(exif);
  const isoSelection = getBucketFacetSelection(ISO_FACET.id, exif.ISO);
  const apertureSelection = getBucketFacetSelection(APERTURE_FACET.id, exif.FNumber);
  const focalLengthSelection =
    getBucketFacetSelection(FOCAL_LENGTH_35MM_FACET.id, exif.FocalLengthIn35mmFormat) ??
    getBucketFacetSelection(FOCAL_LENGTH_ACTUAL_FACET.id, exif.FocalLength);
  const displayDimensions = getDisplayDimensions(props.block);
  const cameraDateTimestamp = exifWallClockTimestamp(exif.DateTimeOriginal);
  return (
    <div
      className={`${styles.block} ${props.block.formatting?.immersive ? styles.immersive : ""}`}
      ref={anchorRef}
      data-testid="photoblockel"
      style={{
        // CSS uses the rendered image width to place the details control just
        // outside its top-right corner on viewports with enough side room.
        ["--photo-aspect" as string]: (
          displayDimensions.width / Math.max(1, displayDimensions.height)
        ).toFixed(4),
        ["--photo-intrinsic-width" as string]: `${displayDimensions.width}px`,
      }}
    >
      <Picture block={props.block} lazy={props.currentIndex > 2} useColourPlaceholder />

      <div className={styles.overlayHeader}>
        {props.block.data.title ? (
          <Heading level={1} as="h1" className={styles.title}>
            {props.block.data.title}
          </Heading>
        ) : null}

        {props.block.data.kicker ? (
          <p className={styles.kicker}>{props.block.data.kicker}</p>
        ) : null}

        {props.block.data.description ? (
          <p className={styles.description}>{props.block.data.description}</p>
        ) : null}
      </div>

      <div
        id={props.block.id}
        className={[commonStyles.mediaDetails, styles.details].filter(Boolean).join(" ")}
      >
        <details
          className={commonStyles.disclosure}
          onToggle={(ev) => {
            setIsDetailsOpen(ev.currentTarget.open);
          }}
        >
          <summary
            aria-label="Photo details"
            title="Photo details"
            className={commonStyles.mediaDetailsSummary}
          >
            <span aria-hidden="true" className={commonStyles.mediaDetailsGlyph}>
              <MediaDetailsIcon />
            </span>
          </summary>

          {isDetailsOpen ? (
            <div className={commonStyles.mediaDetailsContent}>
              <div
                className={[styles.exif, commonStyles.mediaDetailsTable].filter(Boolean).join(" ")}
              >
                <ExifTable
                  rows={[
                    {
                      kind: "coordinates",
                      k: "Location",
                      v: {
                        GPSLatitudeRef: props.block._build.exif.GPSLatitudeRef,
                        GPSLatitude: props.block._build.exif.GPSLatitude,
                        GPSLongitudeRef: props.block._build.exif.GPSLongitudeRef,
                        GPSLongitude: props.block._build.exif.GPSLongitude,
                        geocode: props.block._build.tags.geocode,
                      },
                      options: {
                        showMap: true,
                        ...(props.block._build.tags.colors?.[0]
                          ? {
                              markerColour: rgbToString(props.block._build.tags.colors[0]),
                            }
                          : {}),
                      },
                      valid: Boolean(
                        props.block._build.exif.GPSLatitudeRef &&
                        props.block._build.exif.GPSLatitude &&
                        props.block._build.exif.GPSLongitudeRef &&
                        props.block._build.exif.GPSLongitude,
                      ),
                    },
                    {
                      kind: "kv",
                      k: "Shutter speed",
                      v: (() => {
                        const t = props.block._build.exif.ExposureTime;
                        if (!t) return undefined;
                        // FRACTION_SLASH gives us nice ligatured fractions (eg,
                        // 1⁄10). The fraction already communicates the value, so
                        // drop the raw float to avoid 19 digits of noise.
                        return t < 1
                          ? `${new Fraction(t).toFraction().replace("/", FRACTION_SLASH)}s`
                          : `${t}s`;
                      })(),
                      valid: Boolean(props.block._build.exif.ExposureTime),
                    },
                    {
                      kind: "kv",
                      k: "ISO",
                      v: withFacetAction(
                        exif.ISO,
                        isoSelection ? buildSearchFacetHref(isoSelection) : null,
                        "Find photos at this ISO",
                      ),
                    },
                    {
                      kind: "kv",
                      k: "Aperture",
                      v: withFacetAction(
                        `𝑓/${exif.FNumber}`,
                        apertureSelection ? buildSearchFacetHref(apertureSelection) : null,
                        "Find photos at this aperture",
                      ),
                      valid: Boolean(exif.FNumber),
                    },
                    {
                      kind: "kv",
                      k: "Exposure compensation",
                      v: props.block._build.exif.ExposureCompensation,
                    },
                    //   { kind: "kv", k: "Flash", v: props.block._build.exif.Flash },
                    {
                      kind: "kv",
                      k: "Focal length",
                      v: withFacetAction(
                        `${exif.FocalLength}mm (actual)${
                          exif.FocalLengthIn35mmFormat
                            ? `; ${exif.FocalLengthIn35mmFormat}mm (35mm equivalent)`
                            : ""
                        }`,
                        focalLengthSelection ? buildSearchFacetHref(focalLengthSelection) : null,
                        "Find photos with this focal length",
                      ),
                      valid: Boolean(exif.FocalLength),
                    },
                    {
                      kind: "kv",
                      k: "Lens",
                      v: withFacetAction(
                        [
                          exif.LensMake,
                          exif.LensModel,
                          exif.LensMake || exif.LensModel ? null : exif.LensInfo,
                        ]
                          .filter(Boolean)
                          .join(" "),
                        lensSelection ? buildSearchFacetHref(lensSelection) : null,
                        "Find photos with this lens",
                      ),
                      valid: Boolean(exif.LensMake || exif.LensModel || exif.LensInfo),
                    },
                    {
                      kind: "kv",
                      k: "Camera",
                      v: withFacetAction(
                        [exif.Make, exif.Model].filter(Boolean).join(" "),
                        cameraSelection ? buildSearchFacetHref(cameraSelection) : null,
                        "Find photos with this camera",
                      ),
                      valid: Boolean(exif.Make || exif.Model),
                    },
                    {
                      kind: "kv",
                      k: "Description",
                      v: props.block._build.exif.ImageDescription,
                    },
                    {
                      kind: "kv",
                      k: "Camera datetime",
                      v: [
                        (() => {
                          const local = normaliseExifWallClockIso(
                            props.block._build.exif.DateTimeOriginal,
                          );
                          return props.block._build.exif.OffsetTime
                            ? `${local} (local @ ${props.block._build.exif.OffsetTime})`
                            : local;
                        })(),
                        cameraDateTimestamp != null ? (
                          <HydratedRelativeTime
                            key="relative-camera-datetime"
                            date={cameraDateTimestamp}
                          />
                        ) : null,
                      ]
                        .filter(Boolean)
                        .map((it, idx) => (
                          <React.Fragment key={`${props.block.id}-camera-datetime-${idx}`}>
                            {it}
                            <br />
                          </React.Fragment>
                        )), // TODO: shift TZ option
                      // Truthy-but-unparseable DateTimeOriginal values parse to
                      // no usable local string or timestamp, so the row would
                      // otherwise render a bare label with an empty value.
                      valid: cameraDateTimestamp != null,
                    },
                    //   { kind: "kv", k: "Software", v: [props.block._build.exif.Software].join(" ") },
                    {
                      kind: "kv",
                      k: "Original size",
                      v: `${props.block._build.width}px × ${props.block._build.height}px (${(
                        (props.block._build.width * props.block._build.height) /
                        1_000_000
                      ).toPrecision(2)} MP) `,
                    },
                    {
                      kind: "kv",
                      k: "Tags",
                      v: props.block._build.tags.tags,
                      valid: Boolean(props.block._build.tags.tags?.length),
                      className: styles.narrowCell,
                    },
                    {
                      kind: "kv",
                      k: "Colours",
                      v: (
                        <div className={styles.colorswatches}>
                          {props.block._build.tags.colors?.map((rgb: number[]) => {
                            const rgbStr = rgbToString(rgb as [number, number, number]);
                            const colorParam = `${rgb[0]},${rgb[1]},${rgb[2]}`;
                            return (
                              <a
                                data-colour-swatch
                                key={rgbStr}
                                href={`/search?color=${colorParam}`}
                                style={{
                                  backgroundColor: rgbStr,
                                }}
                                className={styles.colorswatch}
                                title={`Search photos with similar colour: ${rgbStr}`}
                                aria-label={`Search photos with similar colour ${rgbStr}`}
                              ></a>
                            );
                          })}
                        </div>
                      ),
                      valid: Boolean(props.block._build.tags.colors?.length),
                    },
                    {
                      kind: "kv",
                      k: "Description (AI)",
                      v: props.block._build.tags.alt_text,
                      className: styles.narrowCell,
                      valid: Boolean(props.block._build.tags?.alt_text),
                    },
                  ]}
                />

                <div className={styles.similarPhotosWrap}>
                  <PhotoSimilarPhotosDeferred
                    {...(props.block._build.tags.path !== undefined
                      ? { path: props.block._build.tags.path }
                      : {})}
                  />
                </div>

                <div className={commonStyles.mediaDetailsViewOriginal}>
                  <a href={`#${props.block.id}`}>Permalink</a>
                  &nbsp;&middot;&nbsp; View{" "}
                  {props.block._build.srcset.map((s, i) => (
                    <React.Fragment key={s.src}>
                      <a target="_blank" href={s.src} rel="noreferrer">
                        {s.width}px
                      </a>
                      {i < props.block._build.srcset.length - 1 ? <>&nbsp;&middot;&nbsp;</> : null}
                    </React.Fragment>
                  ))}
                </div>

                <details className={commonStyles.mediaDetailsRaw}>
                  <summary>Raw EXIF</summary>
                  <pre>{JSON.stringify(props.block._build.exif, null, 2)}</pre>
                </details>

                <details>
                  <summary>License</summary>
                  <License />
                </details>
              </div>
            </div>
          ) : null}
        </details>
      </div>
    </div>
  );
};
