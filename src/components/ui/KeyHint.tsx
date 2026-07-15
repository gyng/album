import styles from "./KeyHint.module.css";

export const KeyHint = ({ className, ...rest }: React.HTMLAttributes<HTMLElement>) => (
  <kbd className={[styles.key, className].filter(Boolean).join(" ")} {...rest} />
);
