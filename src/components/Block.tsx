import { Block, PhotoBlock, TextBlock } from "../services/types";
import { PhotoBlockEl } from "./Photo";
import { TextBlockEl } from "./TextBlock";

export const BlockEl: React.FC<{
  b: Block;
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
    default:
      return <pre>Unsupported block {JSON.stringify(props.b, null, 2)}</pre>;
  }
};
