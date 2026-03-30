import styles from "./Input.module.css";

export const Input = (
  props: React.InputHTMLAttributes<HTMLInputElement>,
) => {
  const { className, ...rest } = props;
  return (
    <input
      className={[styles.input, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
};
