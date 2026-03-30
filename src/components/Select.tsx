import styles from "./Select.module.css";

export const Select = (
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) => {
  const { className, children, ...rest } = props;
  return (
    <select
      className={[styles.select, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </select>
  );
};
