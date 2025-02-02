import React from "react";
import styles from "./SearchTag.module.css";

interface SearchTagProps {
  tag: string;
  count: number;
  isActive?: boolean;
  onClick: (tag: string) => void;
}

export const SearchTag: React.FC<SearchTagProps> = ({
  tag,
  count,
  onClick,
  isActive,
}) => {
  const tagName = tag.toLocaleLowerCase();
  return (
    <div
      className={[styles.tag, isActive ? styles.active : ""].join(" ")}
      onClick={() => onClick(tagName)}
    >
      {tagName} <span className={styles.count}>{count}</span>
    </div>
  );
};
