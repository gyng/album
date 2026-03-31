import { forwardRef } from "react";
import styles from "./Input.module.css";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...rest }, ref) => (
  <input
    ref={ref}
    className={[styles.input, className].filter(Boolean).join(" ")}
    {...rest}
  />
));

Input.displayName = "Input";
