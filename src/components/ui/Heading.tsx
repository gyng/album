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
  className?: string;
  children: React.ReactNode;
}) => {
  const { as: Tag = "p", className, children } = props;
  return (
    <Tag className={[styles.caption, className].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
};
