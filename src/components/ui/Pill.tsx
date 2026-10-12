import styles from "./Pill.module.css";

export { default as pillStyles } from "./Pill.module.css";

const getClassName = (
  variant: "surface" | "ghost" | undefined,
  size: "compact" | undefined,
  className: string | undefined,
) =>
  [
    styles.base,
    variant === "ghost" ? styles.ghost : styles.surface,
    size === "compact" ? styles.compact : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

export const Pill = (
  props: {
    variant?: "surface" | "ghost";
    size?: "compact";
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>,
) => {
  const { variant, size, className, children, ...rest } = props;
  return (
    <a className={getClassName(variant, size, className)} {...rest}>
      {children}
    </a>
  );
};

export const PillButton = (
  props: {
    variant?: "surface" | "ghost";
    size?: "compact";
  } & React.ButtonHTMLAttributes<HTMLButtonElement>,
) => {
  const { variant, size, className, ...rest } = props;
  return <button type="button" className={getClassName(variant, size, className)} {...rest} />;
};
