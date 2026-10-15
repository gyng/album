import { useId } from "react";
import { jigsawPiecePath } from "../../util/photoJigsaw";
import styles from "./PhotoJigsaw.module.css";

/** The crop includes neighbouring pixels in each tab, so joined pieces reconstruct the photograph. */
export const JigsawPiece = ({
  piece,
  size,
  src,
  empty = false,
}: {
  piece: number;
  size: number;
  src: string;
  empty?: boolean;
}) => {
  const id = useId();
  const path = jigsawPiecePath(piece, size);
  return (
    <svg
      className={styles.shape}
      viewBox="-24 -24 148 148"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={id}>
          <path d={path} />
        </clipPath>
      </defs>
      {empty ? null : (
        <image
          href={src}
          x={-(piece % size) * 100}
          y={-Math.floor(piece / size) * 100}
          width={size * 100}
          height={size * 100}
          preserveAspectRatio="none"
          clipPath={`url(#${id})`}
        />
      )}
      <path
        d={path}
        fill={empty ? "var(--c-bg)" : "none"}
        stroke="var(--c-border)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
