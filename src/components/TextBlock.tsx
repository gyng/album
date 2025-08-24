import { TextBlock } from "../services/types";
import styles from "./TextBlock.module.css";
import React from "react";

export const TextBlockEl: React.FC<{
  block: TextBlock;
  currentIndex: number;
}> = (props) => {
  return (
    <div className={styles.block}>
      <div className={styles.content}>
        <h1 className={styles.title}>{props.block.data.title}</h1>
        {props.block.data.kicker ? (
          <p className={styles.kicker}>{props.block.data.kicker}</p>
        ) : null}
        {props.block.data.description ? (
          <p className={styles.description}>{props.block.data.description}</p>
        ) : null}
      </div>
    </div>
  );
};
