import styles from "./TooltipSurface.module.css";

type Props = React.ComponentPropsWithoutRef<"span">;

export const TooltipSurface = ({ className, children, ...props }: Props) => (
  <span {...props} className={[styles.surface, className].filter(Boolean).join(" ")}>
    {children}
  </span>
);
