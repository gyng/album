import Link from "next/link";
import styles from "./Footer.module.css";

export const Footer = () => (
  <footer className={styles.footer}>
    <Link href="/design" className={styles.link}>
      Design
    </Link>
  </footer>
);
