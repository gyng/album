import common from "../../styles/common.module.css";
import styles from "./Heading.module.css";

const defaultElements = { 1: "h2", 2: "h3", 3: "h4" } as const;
const levelClasses = { 1: styles.level1, 2: styles.level2, 3: styles.level3 };

export const Heading = (props: {
  level: 1 | 2 | 3;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "div";
  className?: string;
  children: React.ReactNode;
}) => {
  const { level, as, className, children } = props;
  const Tag = as ?? defaultElements[level];
  return (
    <Tag
      className={[styles.heading, levelClasses[level], className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Tag>
  );
};

export const Caption = (props: {
  as?: "p" | "span" | "div";
  size?: "sm";
  className?: string;
  children: React.ReactNode;
}) => {
  const { as: Tag = "p", size, className, children } = props;
  const base = size === "sm" ? common.captionSm : common.caption;
  return (
    <Tag className={[base, className].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
};
