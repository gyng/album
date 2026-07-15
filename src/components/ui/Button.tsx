import { forwardRef } from "react";
import styles from "./Button.module.css";

export { default as buttonStyles } from "./Button.module.css";

type ButtonVariant = "surface" | "accent" | "quiet";
type ButtonSize = "standard" | "large" | "icon";

const getClassName = (
  variant: ButtonVariant | undefined,
  size: ButtonSize | undefined,
  active: boolean | undefined,
  className: string | undefined,
) =>
  [
    styles.base,
    variant === "accent" ? styles.accent : "",
    variant === "quiet" ? styles.quiet : "",
    size === "large" ? styles.large : "",
    size === "icon" ? styles.icon : "",
    active ? styles.active : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

type SharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
};

export const Button = forwardRef<
  HTMLButtonElement,
  SharedProps & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ variant, size, active, className, type = "button", ...rest }, ref) => (
  <button
    ref={ref}
    type={type}
    className={getClassName(variant, size, active, className)}
    {...rest}
  />
));

Button.displayName = "Button";

export const ButtonLink = ({
  variant,
  size,
  active,
  className,
  children,
  ...rest
}: SharedProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a className={getClassName(variant, size, active, className)} {...rest}>
    {children}
  </a>
);
