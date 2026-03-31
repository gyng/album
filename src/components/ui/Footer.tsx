import Link from "next/link";
import styles from "./Footer.module.css";

export const Footer = () => (
  <footer className={styles.footer}>
    <a href="https://www.github.com/gyng/album" target="_blank" rel="noreferrer" className={styles.link}>
      GitHub
    </a>
    <span className={styles.separator}>&middot;</span>
    <a href="https://mastodon.yshi.org/@f" target="_blank" rel="noreferrer" className={styles.link}>
      Fediverse
    </a>
    <span className={styles.separator}>&middot;</span>
    <a href="https://bsky.app/profile/gyng.bsky.social" target="_blank" rel="noreferrer" className={styles.link}>
      Bluesky
    </a>
    <span className={styles.separator}>&middot;</span>
    <Link href="/design" className={styles.link}>
      Design
    </Link>
  </footer>
);
