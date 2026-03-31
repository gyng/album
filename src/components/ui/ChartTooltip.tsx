import styles from "./ChartTooltip.module.css";

export const ChartTooltip = (props: {
  children: React.ReactNode;
  className?: string;
}) => {
  const { children, className } = props;
  return (
    <span
      data-tooltip
      className={[styles.tooltip, className].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
};
