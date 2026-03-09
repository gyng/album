import {
  Content,
  IBlock,
  PhotoBlock,
  TextBlock,
  VideoBlock,
} from "../services/types";
import { PhotoBlockEl } from "./Photo";
import styles from "./PhotoAlbum.module.css";
import { TextBlockEl } from "./TextBlock";
import { LocalVideoBlockEl, YoutubeBlockEl } from "./VideoBlock";

export const Block: React.FC<{
  b: IBlock;
  i: number;
}> = (props) => {
  switch (props.b.kind) {
    case "photo":
      return (
        <PhotoBlockEl block={props.b as PhotoBlock} currentIndex={props.i} />
      );
    case "text":
      return (
        <TextBlockEl block={props.b as TextBlock} currentIndex={props.i} />
      );
    case "video":
      if ((props.b as VideoBlock).data.type === "youtube") {
        return (
          <YoutubeBlockEl
            id={(props.b as VideoBlock).id}
            src={(props.b as VideoBlock).data.href}
            date={(props.b as VideoBlock).data.date}
          />
        );
      } else if ((props.b as VideoBlock).data.type === "local") {
        return (
          <LocalVideoBlockEl
            id={(props.b as VideoBlock).id}
            src={(props.b as VideoBlock).data.href}
            originalSrc={(props.b as VideoBlock)._build?.originalSrc}
            date={(props.b as VideoBlock).data.date}
            mimeType={(props.b as VideoBlock)._build?.mimeType}
            originalTechnicalData={
              (props.b as VideoBlock)._build?.originalTechnicalData
            }
          />
        );
      } else {
        return (
          <pre>Unsupported video type {JSON.stringify(props.b, null, 2)}</pre>
        );
      }
    default:
      return <pre>Unsupported block {JSON.stringify(props.b, null, 2)}</pre>;
  }
};

export const PhotoAlbum: React.FC<{
  album: Content;
}> = (props) => {
  return (
    <div className={styles.page}>
      <div className={styles.album}>
        {props.album.blocks.map((b, i) => {
          return (
            <div key={`${b.id}-${i}`} className={styles.block}>
              <Block b={b} i={i} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
