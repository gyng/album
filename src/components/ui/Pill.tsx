import styles from "./Pill.module.css";

export { default as pillStyles } from "./Pill.module.css";

const getClassName = (
  variant: "surface" | "ghost" | undefined,
  className: string | undefined,
) =>
  [
    styles.base,
    variant === "ghost" ? styles.ghost : styles.surface,
    className,
  ]
    .filter(Boolean)
    .join(" ");

export const Pill = (
  props: {
    variant?: "surface" | "ghost";
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>,
) => {
  const { variant, className, ...rest } = props;
  return <a className={getClassName(variant, className)} {...rest} />;
};

export const PillButton = (
  props: {
    variant?: "surface" | "ghost";
  } & React.ButtonHTMLAttributes<HTMLButtonElement>,
) => {
  const { variant, className, ...rest } = props;
  return (
    <button
      type="button"
      className={getClassName(variant, className)}
      {...rest}
    />
  );
};
