/* eslint react-hooks/exhaustive-deps: 0 */

import React from "react";
import { IBlock } from "../../api/types";
import styles from "../Photo.module.css";

export const MoveControl: React.FC<{
  anchorRef: React.RefObject<HTMLElement>;
  currentIndex: number;
  block: IBlock;
  edit: { onEdit: (block: IBlock, newIndex: number) => void; maxIndex: number };
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

    props.anchorRef.current?.scrollIntoView({ behavior: "smooth" });
    setTriggered(false);
  }, [props.currentIndex]);

  return (
    <label>
      <p>Move</p>
      <div className={styles.moveButtons}>
        <button
          disabled={props.currentIndex === 0}
          onClick={() => {
            setTriggered(true);
            props.edit.onEdit(props.block, props.currentIndex - 1);
          }}
        >
          ▲ Up
        </button>
        <button
          disabled={props.currentIndex === props.edit.maxIndex - 1}
          onClick={() => {
            setTriggered(true);
            props.edit.onEdit(props.block, props.currentIndex + 1);
          }}
        >
          ▼ Down
        </button>
        #{props.currentIndex + 1}
      </div>
    </label>
  );
};
