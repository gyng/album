import styles from "./LoadingIndicator.module.css";

export const LoadingIndicator = ({ label }: { label: string }) => (
  <span className={styles.indicator}>
    <span className={styles.spinner} aria-hidden="true" />
    <span>{label}</span>
  </span>
);
