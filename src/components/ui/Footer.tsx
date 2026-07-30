import { AppLink as Link } from "../platform";
import { siteConfig } from "../../lib/siteConfig";
import styles from "./Footer.module.css";

const separator = <span className={styles.separator}>&middot;</span>;

/**
 * External links come from configuration, so a fork ships its own accounts (or
 * none at all). The internal routes below are part of the site, not identity.
 */
export const Footer = () => (
  <footer className={styles.footer}>
    {siteConfig.social.map((link) => (
      <span key={link.href}>
        <a href={link.href} target="_blank" rel="noreferrer" className={styles.link}>
          {link.label}
        </a>
        {separator}
      </span>
    ))}
    <Link href="/design" className={styles.link}>
      Design
    </Link>
    {separator}
    <Link href="/benchmark" className={styles.link}>
      Benchmark
    </Link>
  </footer>
);
