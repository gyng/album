import React from "react";
import styles from "./SearchTag.module.css";

interface SearchTagProps {
  tag: string;
  count: number;
  isActive?: boolean;
  disabled?: boolean;
  onClick: (tag: string) => void;
}

export const SearchTag: React.FC<SearchTagProps> = ({
  tag,
  count,
  onClick,
  isActive,
  disabled,
}) => {
  const tagName = tag.toLocaleLowerCase();
  return (
    <button
      type="button"
      className={[
        styles.tag,
        isActive ? styles.active : "",
        disabled ? styles.disabled : "",
      ].join(" ")}
      disabled={disabled}
      aria-pressed={isActive}
      onClick={() => onClick(tagName)}
    >
      {tagName} <span className={styles.count}>{count}</span>
    </button>
  );
};
