import styles from "./OverlayButton.module.css";

export { default as overlayButtonStyles } from "./OverlayButton.module.css";

const getClassName = (size: "small" | "compact" | undefined, className: string | undefined) =>
  [
    styles.base,
    size === "small" ? styles.small : size === "compact" ? styles.compact : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

export const OverlayButton = (
  props: {
    size?: "small" | "compact";
  } & React.ButtonHTMLAttributes<HTMLButtonElement>,
) => {
  const { size, className, ...rest } = props;
  return <button type="button" className={getClassName(size, className)} {...rest} />;
};

export const OverlayButtonLink = (
  props: {
    size?: "small" | "compact";
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>,
) => {
  const { size, className, children, ...rest } = props;
  return (
    <a className={getClassName(size, className)} {...rest}>
      {children}
    </a>
  );
};
