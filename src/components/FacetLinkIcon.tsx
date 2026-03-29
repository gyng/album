import Link from "next/link";
import styles from "./FacetLinkIcon.module.css";

type Props = {
  href: string;
  label: string;
  className?: string;
};

export const FacetLinkIcon: React.FC<Props> = ({
  href,
  label,
  className,
}) => {
  return (
    <Link
      href={href}
      className={[styles.link, className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
    >
      ↗
    </Link>
  );
};
