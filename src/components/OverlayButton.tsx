import styles from "./OverlayButton.module.css";

const getClassName = (
  size: "small" | undefined,
  className: string | undefined,
) =>
  [styles.base, size === "small" ? styles.small : "", className]
    .filter(Boolean)
    .join(" ");

export const OverlayButton = (
  props: {
    size?: "small";
  } & React.ButtonHTMLAttributes<HTMLButtonElement>,
) => {
  const { size, className, ...rest } = props;
  return (
    <button
      type="button"
      className={getClassName(size, className)}
      {...rest}
    />
  );
};

export const OverlayButtonLink = (
  props: {
    size?: "small";
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>,
) => {
  const { size, className, ...rest } = props;
  return <a className={getClassName(size, className)} {...rest} />;
};
