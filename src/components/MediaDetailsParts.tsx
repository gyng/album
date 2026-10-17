import type { JSX } from "react";
import type { Exif } from "../services/types";
import { rgbToString } from "../util/colorDistance";
import { formatExposureTime } from "../util/formatExposureTime";
import { formatLensInfo } from "../util/formatLensInfo";
import {
  APERTURE_FACET,
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  ISO_FACET,
} from "../util/photoBuckets";
import {
  buildSearchFacetHref,
  buildSearchHref,
  getBucketFacetSelection,
  getCameraFacetSelection,
  getLensFacetSelection,
} from "../util/searchFacets";
import { FacetLinkIcon } from "./FacetLinkIcon";
import { AppLink } from "./platform";
import { forceDocumentNavigation } from "./search/searchUtils";
import styles from "./MediaDetailsParts.module.css";

// The details a photograph and a clip share: the camera and its exposure, the
// indexed tags and colours. A clip's camera arrives under a photograph's EXIF
// keys (services/movieExif.ts), so one set of rows describes both.

export type MediaDetailValue =
  | string
  | string[]
  | number
  | JSX.Element
  | JSX.Element[]
  | undefined
  | null;

export type MediaDetailRow = {
  kind: "kv";
  /** Display key */
  k: string;
  /** Display value */
  v: MediaDetailValue;
  valid?: boolean;
  className?: string | undefined;
};

export const withFacetAction = (
  value: MediaDetailValue,
  href: string | null,
  label: string,
): MediaDetailValue => {
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

/** The camera, lens and exposure rows, each linking to its search facet. */
export const cameraExifRows = (exif: Exif): MediaDetailRow[] => {
  const cameraSelection = getCameraFacetSelection(exif);
  const lensSelection = getLensFacetSelection(exif);
  const isoSelection = getBucketFacetSelection(ISO_FACET.id, exif.ISO);
  const apertureSelection = getBucketFacetSelection(APERTURE_FACET.id, exif.FNumber);
  const focalLengthSelection =
    getBucketFacetSelection(FOCAL_LENGTH_35MM_FACET.id, exif.FocalLengthIn35mmFormat) ??
    getBucketFacetSelection(FOCAL_LENGTH_ACTUAL_FACET.id, exif.FocalLength);
  return [
    {
      kind: "kv",
      k: "Shutter speed",
      v: exif.ExposureTime ? formatExposureTime(exif.ExposureTime) : undefined,
      valid: Boolean(exif.ExposureTime),
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
      v: exif.ExposureCompensation,
    },
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
          exif.LensMake || exif.LensModel ? null : formatLensInfo(exif.LensInfo),
        ]
          .filter(Boolean)
          .join(" "),
        lensSelection ? buildSearchFacetHref(lensSelection) : null,
        "Find photos with this lens",
      ),
      valid: Boolean(exif.LensMake || exif.LensModel || formatLensInfo(exif.LensInfo)),
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
  ];
};

export const TagLinks: React.FC<{ tags: readonly string[] }> = ({ tags }) => (
  <ul className={styles.tagLinks}>
    {tags.map((tag) => (
      <li key={tag}>
        <AppLink
          href={buildSearchHref({ query: [tag] })}
          onClick={(event) => forceDocumentNavigation(event, buildSearchHref({ query: [tag] }))}
          className={styles.tagLink}
        >
          {tag}
        </AppLink>
      </li>
    ))}
  </ul>
);

export const ColourSwatches: React.FC<{ colors: readonly number[][] }> = ({ colors }) => (
  <div className={styles.colorswatches}>
    {colors.map((rgb) => {
      const rgbStr = rgbToString(rgb as [number, number, number]);
      const colorParam = `${rgb[0]},${rgb[1]},${rgb[2]}`;
      return (
        <AppLink
          data-colour-swatch
          key={rgbStr}
          href={`/search?color=${colorParam}`}
          onClick={(event) => forceDocumentNavigation(event, `/search?color=${colorParam}`)}
          style={{
            backgroundColor: rgbStr,
          }}
          className={styles.colorswatch}
          title={`Search photos with similar colour: ${rgbStr}`}
          aria-label={`Search photos with similar colour ${rgbStr}`}
        />
      );
    })}
  </div>
);

/** A narrow column, for rows whose value is a list rather than a line. */
export const narrowCellClass = styles.narrowCell;
/** A value with its facet link beside it. */
export const detailValueWithActionClass = styles.detailValueWithAction;
