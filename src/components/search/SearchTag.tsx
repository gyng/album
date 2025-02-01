import React from "react";
import styles from "./SearchTag.module.css";

interface SearchTagProps {
  tag: string;
  count: number;
  onClick: (tag: string) => void;
}

export const SearchTag: React.FC<SearchTagProps> = ({
  tag,
  count,
  onClick,
}) => {
  const tagName = tag.toLocaleLowerCase();
  return (
    <div className={styles.tag} onClick={() => onClick(tagName)}>
      {tagName} <i>{count}</i>
    </div>
  );
};
