import {
  Content,
  IBlock,
  PhotoBlock,
  TextBlock,
  VideoBlock,
} from "../services/types";
import { BlockControl, BlockControlOptions } from "./editor/BlockControl";
import { EditPhotoBlockOptions, PhotoBlockEl } from "./Photo";
import styles from "./PhotoAlbum.module.css";
import { EditTextBlockOptions, TextBlockEl } from "./TextBlock";
import { YoutubeBlockEl } from "./VideoBlock";

export const Block: React.FC<{
  b: IBlock;
  i: number;
  extraProps: {
    editPhotoBlock: EditPhotoBlockOptions;
    editTextBlock: EditTextBlockOptions;
  };
}> = (props) => {
  switch (props.b.kind) {
    case "photo":
      return (
        <PhotoBlockEl
          block={props.b as PhotoBlock}
          currentIndex={props.i}
          edit={props.extraProps.editPhotoBlock}
        />
      );
    case "text":
      return (
        <TextBlockEl
          block={props.b as TextBlock}
          currentIndex={props.i}
          edit={props.extraProps.editTextBlock}
        />
      );
    case "video":
      if ((props.b as VideoBlock).data.type === "youtube") {
        return <YoutubeBlockEl src={(props.b as VideoBlock).data.href} />;
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
  editPhotoBlock: EditPhotoBlockOptions;
  editTextBlock: EditTextBlockOptions;
  blockControl: BlockControlOptions;
}> = (props) => {
  return (
    <div className={styles.page}>
      <div className={styles.album}>
        {props.album.blocks.map((b, i) => {
          return (
            <div key={`${b.id}-${i}`} className={styles.block}>
              {props.blockControl.isEditing ? (
                <BlockControl
                  currentIndex={i}
                  key={b.id}
                  edit={props.blockControl}
                />
              ) : null}

              <Block
                b={b}
                i={i}
                extraProps={{
                  editPhotoBlock: props.editPhotoBlock,
                  editTextBlock: props.editTextBlock,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
