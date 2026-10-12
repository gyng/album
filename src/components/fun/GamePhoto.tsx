import { AppLink } from "../platform";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";
import type { PhotoGamePhoto } from "../../util/photoGames";
import styles from "./PhotoGames.module.css";

export const GamePhoto = ({ photo, link = false }: { photo: PhotoGamePhoto; link?: boolean }) => {
  const image = (
    <img
      src={getResizedAlbumImageSrc(photo.path)}
      alt={photo.caption || "Archive photograph"}
      className={styles.photo}
      loading="lazy"
    />
  );
  return link ? (
    <AppLink href={photo.href} className={styles.photoLink}>
      {image}
    </AppLink>
  ) : (
    image
  );
};

export const PhotoChain = ({
  photos,
  linked = true,
  similarities,
  numbered = true,
}: {
  photos: PhotoGamePhoto[];
  linked?: boolean;
  similarities?: Array<number | null>;
  numbered?: boolean;
}) => (
  <ol className={styles.chain}>
    {photos.map((photo, index) => (
      <li key={photo.path}>
        <GamePhoto photo={photo} link={linked} />
        {numbered ? <span className={styles.step}>{index + 1}</span> : null}
        {similarities?.[index] !== undefined && similarities[index] !== null ? (
          <span className={styles.step}>Next link · {similarities[index]}% similarity</span>
        ) : null}
      </li>
    ))}
  </ol>
);
