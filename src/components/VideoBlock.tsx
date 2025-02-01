// import { OnDeleteFn, TextBlock } from "../services/types";
import styles from "./VideoBlock.module.css";
import React from "react";

export type YoutubeBlockElProps = {
  src: string;

  // Deprecated
  //   isEditing: boolean;
  //   onEdit: (newBlock: TextBlock, newIndex: number) => void;
  //   onDelete: OnDeleteFn;
  //   maxIndex: number;
};

export const YoutubeBlockEl: React.FC<YoutubeBlockElProps> = (props) => {
  return (
    <div className={styles.youtubeWrapper}>
      <iframe
        className={styles.youtubeIframe}
        width="560"
        height="315"
        src={props.src}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      ></iframe>
    </div>
  );
};
