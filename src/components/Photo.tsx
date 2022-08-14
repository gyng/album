import Fraction from "fraction.js";
import styles from "./Photo.module.css";
import editStyles from "./EditContainer.module.css";
import { OnDeleteFn, OnEditFn, PhotoBlock } from "../api/types";
import { MapDeferred } from "./MapDeferred";
import React from "react";
import { MoveControl } from "./editor/MoveBlock";
import { InputFieldControl } from "./editor/InputFieldControl";
import { DeleteBlock } from "./editor/DeleteBlock";

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
                props.currentIndex
              );
            }}
          />
          <span>Full-width</span>
        </div>
      </label>
    </div>
  );
};

const ExifCoordinatesRow: React.FC<{ row: ExifCoordinatesRowProps }> = (
  props
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

  const convertDMSToDegree = (coords?: number[]): number | null => {
    if (!coords || coords.length !== 3) {
      return null;
    }
    return coords[0] + coords[1] / 60 + coords[2] / 3600;
  };

  const decLng = convertDMSToDegree(props.row.data.GPSLongitude);
  const decLat = convertDMSToDegree(props.row.data.GPSLatitude);

  return (
    <>
      <tr>
        <td>{props.row.k}</td>
        <td>{formatted}</td>
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
      v: string;
      options?: any;
      valid?: boolean;
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
                  <ExifRow key={row.k} k={row.k} v={row.v} />
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

export const ExifRow: React.FC<{ k: string; v: string; valid?: boolean }> = (
  props
) => {
  if (props.valid === false) {
    return null;
  }

  return (
    <tr>
      <td>{props.k}</td>
      <td>{props.v}</td>
    </tr>
  );
};

export type PhotoBlockEditDetails = {
  description: string;
};

export const Picture: React.FC<{ block: PhotoBlock; thumb?: boolean }> = (
  props
) => {
  return (
    <picture className={styles.imageWrapper}>
      {props.block._build.srcset.map((srcset) => (
        <source
          key={srcset.src}
          srcSet={srcset.src}
          media={`(min-width: ${srcset.width * (props.thumb ? 1.4 : 0.8)}px)`}
        />
      ))}

      <img
        className={styles.image}
        src={props.block.data.src}
        height={props.block._build.height}
        width={props.block._build.width}
        loading="lazy"
        alt={
          props.block.data.title ??
          props.block.data.kicker ??
          props.block.data.description
        }
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

  return (
    <div
      className={`${styles.block} ${
        props.block.formatting?.immersive ? styles.immersive : ""
      }`}
      id={props.block.id}
      ref={anchorRef}
    >
      <Picture block={props.block} />

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

      <div className={styles.details}>
        <a className={styles.permalink} href={`#${props.block.id}`}>
          Permalink
        </a>

        <details>
          <summary>Details</summary>
          <div className={styles.exif}>
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
                  },
                  options: {
                    showMap: true,
                  },
                  valid: Boolean(
                    props.block._build.exif.GPSLatitudeRef &&
                      props.block._build.exif.GPSLatitude &&
                      props.block._build.exif.GPSLongitudeRef &&
                      props.block._build.exif.GPSLongitude
                  ),
                },
                {
                  kind: "kv",
                  k: "Shutter speed",
                  v:
                    props.block._build.exif.ExposureTime < 1
                      ? new Fraction(props.block._build.exif.ExposureTime)
                          .toFraction()
                          .replace("/", FRACTION_SLASH) // FRACTION_SLASH gives us nice ligatured fractions (eg, 1⁄10)
                      : props.block._build.exif.ExposureTime,
                },
                {
                  kind: "kv",
                  k: "ISO",
                  v: props.block._build.exif.ISO,
                },
                {
                  kind: "kv",
                  k: "𝑓",
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
                  v: `${props.block._build.exif.FocalLength}mm (actual)`,
                  valid: Boolean(props.block._build.exif.FocalLength),
                },
                {
                  kind: "kv",
                  k: "Lens info",
                  v: props.block._build.exif.LensInfo,
                },
                {
                  kind: "kv",
                  k: "Datetime",
                  v: props.block._build.exif.DateTimeOriginal?.replace(
                    /Z$/,
                    ""
                  ), // TODO: shift TZ option
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
                      props.block._build.exif.Model
                  ),
                },
                //   { kind: "kv", k: "Software", v: [props.block._build.exif.Software].join(" ") },
              ]}
            />

            <div className={styles.viewOriginal}>
              View{" "}
              <a href={props.block.data.src} target="_blank" rel="noreferrer">
                original
              </a>
              {props.block._build.srcset.length > 0 ? (
                <>
                  &nbsp;&middot;&nbsp;
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
          </div>
        </details>
      </div>

      {props.edit?.isEditing ? (
        <EditPhotoBlock
          anchorRef={anchorRef}
          block={props.block}
          currentIndex={props.currentIndex}
          edit={props.edit}
        />
      ) : null}
    </div>
  );
};
