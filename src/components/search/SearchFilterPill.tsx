import React from "react";
import styles from "./SearchFilterPill.module.css";

type Props = {
  label: string;
  labelPrefix?: React.ReactNode;
  count?: number | undefined;
  isActive?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
};

export const SearchFilterPill: React.FC<Props> = ({
  label,
  labelPrefix,
  count,
  isActive,
  disabled,
  onClick,
}) => {
  return (
    <button
      type="button"
      className={[styles.pill, isActive ? styles.active : "", disabled ? styles.disabled : ""].join(
        " ",
      )}
      disabled={disabled}
      aria-pressed={isActive}
      onClick={onClick}
    >
      {labelPrefix ? <span className={styles.prefix}>{labelPrefix}</span> : null}
      {label}
      {count != null ? <span className={styles.count}>{count}</span> : null}
    </button>
  );
};
