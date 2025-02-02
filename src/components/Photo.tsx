import Fraction from "fraction.js";
import styles from "./Photo.module.css";
import editStyles from "./EditContainer.module.css";
import { OnDeleteFn, OnEditFn, PhotoBlock } from "../services/types";
import { MapDeferred } from "./MapDeferred";
import React from "react";
import { MoveControl } from "./editor/MoveBlock";
import { InputFieldControl } from "./editor/InputFieldControl";
import { DeleteBlock } from "./editor/DeleteBlock";
import { License } from "../License";
import { getDegLatLngFromExif } from "../util/dms2deg";
import { getRelativeTimeString } from "../util/time";

import type { JSX } from "react";

type ExifCoordinatesRowProps = {
  kind: "coordinates";
  /** Display key */
  k: string;
  /** https://exiftool.org/TagNames/GPS.html */
  data: {
    GPSLatitudeRef: string;
    GPSLatitude: [number, number, number];
    GPSLongitudeRef: string;
    GPSLongitude: [number, number, number];
    geocode?: string;
  };
  options: {
    showMap: boolean;
  };
};

export type EditPhotoBlockOptions = {
  onEdit: OnEditFn;
  onDelete: OnDeleteFn;
  isEditing: boolean;
  maxIndex: number;
};

const EditPhotoBlock: React.FC<{
  block: PhotoBlock;
  currentIndex: number;
  edit: EditPhotoBlockOptions;
  anchorRef: React.RefObject<HTMLElement>;
}> = (props) => {
  const [initial, setInitial] = React.useState(true);
  const [triggered, setTriggered] = React.useState(false);

  React.useEffect(() => {
    if (initial) {
      setInitial(false);
      return;
    }

    if (!triggered) {
      return;
    }

    document
      .getElementById(props.block.id)
      ?.scrollIntoView({ behavior: "smooth" });
    setTriggered(false);
  }, [props.currentIndex, initial, props.block.id, triggered]);

  return (
    <div className={`${editStyles.editContainer} ${editStyles.gridRight}`}>
      <InputFieldControl
        block={props.block}
        name="title"
        label="Title"
        currentIndex={props.currentIndex}
        edit={props.edit}
      />

      <InputFieldControl
        block={props.block}
        name="kicker"
        label="Kicker"
        currentIndex={props.currentIndex}
        edit={props.edit}
      />

      <InputFieldControl
        block={props.block}
        name="description"
        label="Description"
        currentIndex={props.currentIndex}
        edit={props.edit}
      />

      <MoveControl
        anchorRef={props.anchorRef}
        block={props.block}
        currentIndex={props.currentIndex}
        edit={props.edit}
      />

      <DeleteBlock edit={props.edit} currentIndex={props.currentIndex} />

      <label>
        <div className={editStyles.checkboxRow}>
          <input
            type="checkbox"
            checked={props.block.formatting?.immersive}
            onChange={(ev) => {
              props.edit.onEdit(
                {
                  ...props.block,
                  data: { ...props.block.data },
                  formatting: {
                    ...props.block.formatting,
                    immersive: ev.target.checked,
                  },
                },
                props.currentIndex,
              );
            }}
          />
          <span>Full-width</span>
        </div>
      </label>

      <label>
        <div className={editStyles.checkboxRow}>
          <input
            type="checkbox"
            checked={props.block.formatting?.immersive}
            onChange={(ev) => {
              props.edit.onEdit(
                {
                  ...props.block,
                  data: { ...props.block.data },
                  formatting: {
                    ...props.block.formatting,
                    cover: ev.target.checked,
                  },
                },
                props.currentIndex,
              );
            }}
          />
          <span>Use as album cover</span>
        </div>
      </label>
    </div>
  );
};

const ExifCoordinatesRow: React.FC<{ row: ExifCoordinatesRowProps }> = (
  props,
) => {
  const formatted = [
    `${props.row.data.GPSLatitude?.[0]}°`,
    `${props.row.data.GPSLatitude?.[1]}′`,
    props.row.data.GPSLatitude?.[2]
      ? `${props.row.data.GPSLatitude?.[2].toFixed(0)}″`
      : null,
    props.row.data.GPSLatitudeRef,
    `${props.row.data.GPSLongitude?.[0]}°`,
    `${props.row.data.GPSLongitude?.[1]}′`,
    props.row.data.GPSLongitude?.[2]
      ? `${props.row.data.GPSLongitude?.[2].toFixed(0)}″`
      : null,
    props.row.data.GPSLongitudeRef,
  ]
    .filter(Boolean)
    .join(" ");

  const { decLat, decLng } = getDegLatLngFromExif({
    GPSLongitude: props.row.data.GPSLongitude,
    GPSLatitude: props.row.data.GPSLatitude,
    GPSLongitudeRef: props.row.data.GPSLongitudeRef,
    GPSLatitudeRef: props.row.data.GPSLatitudeRef,
  });

  return (
    <>
      <tr>
        <td>{props.row.k}</td>
        <td>
          {formatted}
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
      {props.row.options.showMap && decLng && decLat ? (
        <tr>
          <td></td>
          <td>
            <MapDeferred coordinates={[decLat, decLng]} />
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
      v: string | JSX.Element | JSX.Element[];
      options?: any;
      valid?: boolean;
      style?: any;
    }
  | {
      kind: "coordinates";
      /** Display key */
      k: string;
      /** https://exiftool.org/TagNames/GPS.html */
      v: {
        GPSLatitudeRef: string;
        GPSLatitude: [number, number, number];
        GPSLongitudeRef: string;
        GPSLongitude: [number, number, number];
        geocode?: string;
      };
      options: {
        showMap: boolean;
      };
      valid?: boolean;
    };

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
                return row.v ? (
                  <ExifRow key={row.k} k={row.k} v={row.v} style={row.style} />
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
  v: string | JSX.Element | JSX.Element[];
  valid?: boolean;
  style?: any;
}> = (props) => {
  if (props.valid === false) {
    return null;
  }

  return (
    <tr>
      <td>{props.k}</td>
      <td style={props.style}>{props.v}</td>
    </tr>
  );
};

export type PhotoBlockEditDetails = {
  description: string;
};

export const Picture: React.FC<{
  block: PhotoBlock;
  thumb?: boolean;
  lazy?: boolean;
  label?: string;
  useColourPlaceholder?: boolean;
}> = (props) => {
  // Dimensions have to be flipped if image is rotated using EXIF
  const isExifPortrait =
    props.block?._build?.exif?.Orientation?.includes("270") ||
    props.block?._build?.exif?.Orientation?.includes("90");
  const actualWidth = isExifPortrait
    ? props.block._build.height
    : props.block._build.width;
  const actualHeight = isExifPortrait
    ? props.block._build.width
    : props.block._build.height;

  const colour = props.block._build?.tags?.colors?.[0];
  const placeholderColour = colour
    ? `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`
    : "transparent";
  // We do this instead of simply setting background-color to `placeholderColor`
  // as using background-color instead fills the entire picture element which can't
  // be sized to be precisely the image size
  // (wide viewports = wide picture element = oversized placeholder overflow)
  const placeholderSvg = `
<svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${actualWidth}" height="${actualHeight}" fill="${placeholderColour}" />
</svg>`;
  const b64Placeholder = btoa(placeholderSvg);

  return (
    // picture is needed for index page, aspect ratio goes all wonky without
    <picture className={styles.imageWrapper}>
      <img
        data-testid="picture"
        className={styles.image}
        srcSet={
          props.thumb
            ? // HACK: pick 1200px as 800 is blurry
              `${props.block._build.srcset[1].src} ${props.block._build.srcset[1].width}w`
            : props.block._build.srcset
                .map((s) => `${s.src} ${s.width}w`)
                .join(", ")
        }
        // Original image is not uploaded
        src={props.block._build.srcset[0].src}
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
        onLoad={(evt) => {
          evt.currentTarget.style.backgroundImage = "unset";
        }}
        // placeholder image sizes
        width={actualWidth}
        height={actualHeight}
        alt={
          props.block._build?.tags?.alt_text ??
          props.block.data.title ??
          props.block.data.kicker ??
          props.block.data.description
        }
        aria-label={props.label}
      />
    </picture>
  );
};

export const PhotoBlockEl: React.FC<{
  block: PhotoBlock;
  currentIndex: number;
  edit?: EditPhotoBlockOptions;
}> = (props) => {
  const FRACTION_SLASH = "⁄";
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);

  return (
    <div
      className={`${styles.block} ${
        props.block.formatting?.immersive ? styles.immersive : ""
      }`}
      ref={anchorRef}
      data-testid="photoblockel"
    >
      <Picture
        block={props.block}
        lazy={props.currentIndex > 2}
        useColourPlaceholder
      />

      <div className={styles.overlayHeader}>
        {props.block.data.title ? (
          <h1 className={styles.title}>{props.block.data.title}</h1>
        ) : null}

        {props.block.data.kicker ? (
          <p className={styles.kicker}>{props.block.data.kicker}</p>
        ) : null}

        {props.block.data.description ? (
          <p className={styles.description}>{props.block.data.description}</p>
        ) : null}
      </div>

      <div
        id={props.block.id ?? props.block.data.src}
        className={styles.details}
      >
        <details
          onToggle={(ev) => {
            setIsDetailsOpen(ev.currentTarget.open);
          }}
        >
          <summary
            title="More details&hellip;"
            className={styles.detailsSummary}
          >
            <span>ⓘ</span>
          </summary>

          {isDetailsOpen ? (
            <div className={styles.detailsContent}>
              <div className={styles.exif}>
                <ExifTable
                  rows={[
                    {
                      kind: "coordinates",
                      k: "Location",
                      v: {
                        GPSLatitudeRef: props.block._build.exif.GPSLatitudeRef,
                        GPSLatitude: props.block._build.exif.GPSLatitude,
                        GPSLongitudeRef:
                          props.block._build.exif.GPSLongitudeRef,
                        GPSLongitude: props.block._build.exif.GPSLongitude,
                        geocode: props.block._build?.tags?.geocode,
                      },
                      options: {
                        showMap: true,
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
                      v:
                        props.block._build.exif.ExposureTime < 1
                          ? `${new Fraction(
                              props.block._build.exif.ExposureTime,
                            )
                              .toFraction()
                              .replace("/", FRACTION_SLASH)}; ${
                              props.block._build.exif.ExposureTime
                            }s` // FRACTION_SLASH gives us nice ligatured fractions (eg, 1⁄10)
                          : `${props.block._build.exif.ExposureTime}s`,
                      valid: Boolean(props.block._build.exif.ExposureTime),
                    },
                    {
                      kind: "kv",
                      k: "ISO",
                      v: props.block._build.exif.ISO,
                    },
                    {
                      kind: "kv",
                      k: "Aperture",
                      v: `𝑓/${props.block._build.exif.FNumber}`,
                      valid: Boolean(props.block._build.exif.FNumber),
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
                      v: `${props.block._build.exif.FocalLength}mm (actual)${
                        props.block._build.exif.FocalLengthIn35mmFormat
                          ? `; ${props.block._build.exif.FocalLengthIn35mmFormat}mm (35mm equivalent)`
                          : ""
                      }`,
                      valid: Boolean(props.block._build.exif.FocalLength),
                    },
                    {
                      kind: "kv",
                      k: "Lens",
                      v: [
                        props.block._build.exif.LensMake,
                        props.block._build.exif.LensModel,
                        // Don't show LensInfo if LensMake or LensModel is present
                        props.block._build.exif.LensModel ||
                        props.block._build.exif.LensModel
                          ? null
                          : props.block._build.exif.LensInfo,
                      ]
                        .filter(Boolean)
                        .join(" "),
                      valid: Boolean(
                        props.block._build.exif.LensMake ||
                          props.block._build.exif.LensModel ||
                          props.block._build.exif.LensInfo,
                      ),
                    },
                    {
                      kind: "kv",
                      k: "Camera",
                      v: [
                        props.block._build.exif.Make,
                        props.block._build.exif.Model,
                      ].join(" "),
                      valid: Boolean(
                        props.block._build.exif.Make ||
                          props.block._build.exif.Model,
                      ),
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
                        props.block._build.exif.OffsetTime
                          ? `${props.block._build.exif.DateTimeOriginal} (local @ ${props.block._build.exif.OffsetTime})`
                          : props.block._build.exif.DateTimeOriginal?.replace(
                              /Z$/,
                              "",
                            ),
                        getRelativeTimeString(
                          new Date(props.block._build.exif.DateTimeOriginal),
                        ),
                      ]
                        .filter(Boolean)
                        .map((it) => (
                          <>
                            {it}
                            <br />
                          </>
                        )), // TODO: shift TZ option
                      valid: Boolean(props.block._build.exif.DateTimeOriginal),
                    },
                    //   { kind: "kv", k: "Software", v: [props.block._build.exif.Software].join(" ") },
                    {
                      kind: "kv",
                      k: "Original size",
                      v: `${props.block._build.width}px × ${
                        props.block._build.height
                      }px (${(
                        (props.block._build.width * props.block._build.height) /
                        1_000_000
                      ).toPrecision(2)} MP) `,
                    },
                    {
                      kind: "kv",
                      k: "Tags",
                      v: props.block._build?.tags?.tags,
                      valid: Boolean(props.block._build.tags),
                      style: { width: "min-content" },
                    },
                    {
                      kind: "kv",
                      k: "Colours",
                      v: (
                        <div className={styles.colorswatches}>
                          {props.block._build?.tags?.colors?.map(
                            (rgb: number[]) => {
                              const rgbStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
                              return (
                                <div
                                  key={rgbStr}
                                  style={{
                                    backgroundColor: rgbStr,
                                  }}
                                  className={styles.colorswatch}
                                  title={rgbStr}
                                ></div>
                              );
                            },
                          )}
                        </div>
                      ),
                      valid: Boolean(props.block._build.tags?.colors),
                    },
                    {
                      kind: "kv",
                      k: "Description (AI)",
                      v: props.block._build?.tags?.alt_text,
                      style: { width: "min-content" },
                      valid: Boolean(props.block._build.tags?.alt_text),
                    },
                  ]}
                />

                <div className={styles.viewOriginal}>
                  <a href={`#${props.block.id ?? props.block.data.src}`}>
                    Permalink
                  </a>
                  &nbsp;&middot;&nbsp; View{" "}
                  {props.block._build.srcset.length > 0 ? (
                    <>
                      {props.block._build.srcset.map((s, i) => (
                        <React.Fragment key={s.src}>
                          <a
                            key={s.src}
                            target="_blank"
                            href={s.src}
                            rel="noreferrer"
                          >
                            {s.width}px
                          </a>
                          {i < props.block._build.srcset.length - 1 ? (
                            <>&nbsp;&middot;&nbsp;</>
                          ) : null}
                        </React.Fragment>
                      ))}
                    </>
                  ) : null}
                </div>

                <details className={styles.rawDetails}>
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

      {props.edit?.isEditing ? (
        <EditPhotoBlock
          // @ts-expect-error
          anchorRef={anchorRef}
          block={props.block}
          currentIndex={props.currentIndex}
          edit={props.edit}
        />
      ) : null}
    </div>
  );
};
