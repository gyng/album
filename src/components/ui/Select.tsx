import styles from "./Select.module.css";

export const Select = (
  props: {
    variant?: "compact";
  } & React.SelectHTMLAttributes<HTMLSelectElement>,
) => {
  const { variant, className, children, ...rest } = props;
  const variantClass = variant === "compact" ? styles.compact : styles.select;
  return (
    <select
      className={[styles.base, variantClass, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </select>
  );
};
