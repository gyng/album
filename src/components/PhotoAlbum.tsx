import { Content, IBlock, PhotoBlock, TextBlock } from "../api/types";
import { BlockControl, BlockControlOptions } from "./editor/BlockControl";
import { EditPhotoBlockOptions, PhotoBlockEl } from "./Photo";
import styles from "./PhotoAlbum.module.css";
import { EditTextBlockOptions, TextBlockEl } from "./TextBlock";

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
            <div key={b.id} className={styles.block}>
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
