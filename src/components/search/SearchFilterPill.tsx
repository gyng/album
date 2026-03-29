import React from "react";
import styles from "./SearchFilterPill.module.css";

type Props = {
  label: string;
  count?: number;
  isActive?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export const SearchFilterPill: React.FC<Props> = ({
  label,
  count,
  isActive,
  disabled,
  onClick,
}) => {
  return (
    <button
      type="button"
      className={[
        styles.pill,
        isActive ? styles.active : "",
        disabled ? styles.disabled : "",
      ].join(" ")}
      disabled={disabled}
      aria-pressed={isActive}
      onClick={onClick}
    >
      {label}
      {count != null ? <span className={styles.count}>{count}</span> : null}
    </button>
  );
};
