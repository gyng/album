import styles from "./Card.module.css";

export const Card = (props: {
  as?: "div" | "article" | "section";
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) => {
  const { as: Tag = "div", className, children, ...rest } = props;
  return (
    <Tag
      className={[styles.card, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
};
