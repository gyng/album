import { Fragment } from "react";
import { AppLink as Link } from "../platform";
import { siteConfig } from "../../lib/siteConfig";
import styles from "./Footer.module.css";

/**
 * External links come from configuration, so a fork ships its own accounts (or
 * none at all). The internal routes below are part of the site, not identity.
 *
 * Items and separators are rendered as siblings on purpose: `.footer` is a flex
 * row whose `gap` spaces its direct children, so wrapping a link and its dot in
 * a shared element collapses the space between them.
 */
const items = [
  ...siteConfig.social.map((link) => ({
    key: link.href,
    node: (
      <a href={link.href} target="_blank" rel="noreferrer" className={styles.link}>
        {link.label}
      </a>
    ),
  })),
  {
    key: "design",
    node: (
      <Link href="/design" className={styles.link}>
        Design
      </Link>
    ),
  },
];

export const Footer = () => (
  <footer className={styles.footer}>
    {items.map((item, index) => (
      <Fragment key={item.key}>
        {item.node}
        {index < items.length - 1 ? <span className={styles.separator}>&middot;</span> : null}
      </Fragment>
    ))}
  </footer>
);
