import styles from "./ChartTooltip.module.css";
import { TooltipSurface } from "./TooltipSurface";

export const ChartTooltip = (props: { children: React.ReactNode; className?: string }) => {
  const { children, className } = props;
  return (
    <TooltipSurface data-tooltip className={[styles.tooltip, className].filter(Boolean).join(" ")}>
      {children}
    </TooltipSurface>
  );
};
