import { OnDeleteFn, OnEditFn, TextBlock } from "../api/types";
import styles from "./TextBlock.module.css";
import editStyles from "./EditContainer.module.css";
import { MoveControl } from "./editor/MoveBlock";
import React from "react";
import { InputFieldControl } from "./editor/InputFieldControl";
import { DeleteBlock } from "./editor/DeleteBlock";

export type EditTextBlockOptions = {
  isEditing: boolean;
  onEdit: (newBlock: TextBlock, newIndex: number) => void;
  onDelete: OnDeleteFn;
  maxIndex: number;
};

export const EditTextBlock: React.FC<{
  anchorRef: React.RefObject<HTMLDivElement>;
  block: TextBlock;
  currentIndex: number;
  edit: EditTextBlockOptions;
}> = (props) => {
  return (
    <div className={`${editStyles.editContainer} ${editStyles.gridRight}`}>
      <InputFieldControl
        block={props.block}
        name="title"
        label="Title"
        currentIndex={props.currentIndex}
        // @ts-expect-error
        edit={props.edit}
      />

      <InputFieldControl
        block={props.block}
        name="kicker"
        label="Kicker"
        currentIndex={props.currentIndex}
        // @ts-expect-error
        edit={props.edit}
      />

      <InputFieldControl
        block={props.block}
        name="description"
        label="Description"
        currentIndex={props.currentIndex}
        // @ts-expect-error
        edit={props.edit}
      />

      <MoveControl
        anchorRef={props.anchorRef}
        block={props.block}
        currentIndex={props.currentIndex}
        // @ts-expect-error
        edit={props.edit}
      />

      <DeleteBlock currentIndex={props.currentIndex} edit={props.edit} />
    </div>
  );
};
export const TextBlockEl: React.FC<{
  block: TextBlock;
  currentIndex: number;
  edit: EditTextBlockOptions;
}> = (props) => {
  const anchorRef = React.useRef<HTMLDivElement>(null);

  return (
    <div className={styles.block} ref={anchorRef}>
      <div className={styles.content}>
        <h1 className={styles.title}>{props.block.data.title}</h1>
        {props.block.data.kicker ? (
          <p className={styles.kicker}>{props.block.data.kicker}</p>
        ) : null}
        {props.block.data.description ? (
          <p className={styles.description}>{props.block.data.description}</p>
        ) : null}
      </div>

      {props.edit.isEditing ? (
        <EditTextBlock
          block={props.block}
          edit={props.edit}
          currentIndex={props.currentIndex}
          anchorRef={anchorRef}
        />
      ) : null}
    </div>
  );
};
