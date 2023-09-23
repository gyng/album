import { Block, PhotoBlock, TextBlock } from "../services/types";
import { EditPhotoBlockOptions, PhotoBlockEl } from "./Photo";
import { EditTextBlockOptions, TextBlockEl } from "./TextBlock";

export const BlockEl: React.FC<{
  b: Block;
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
