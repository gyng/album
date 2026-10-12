import { AppLink } from "../platform";
import { useEffect, useRef } from "react";
import { FUN_GAMES, type FunPage } from "./games";
import styles from "./FunSubnav.module.css";

export const FunSubnav = ({ current }: { current: FunPage }) => {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    const reveal = () => {
      if (cancelled) return;
      navRef.current
        ?.querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: "auto" });
    };
    reveal();
    void document.fonts?.ready.then(reveal);
    return () => {
      cancelled = true;
    };
  }, [current]);
  return (
    <nav ref={navRef} className={styles.nav} aria-label="Fun games">
      {[{ id: "fun", href: "/fun", title: "All games" }, ...FUN_GAMES].map((game) => (
        <AppLink
          key={game.id}
          href={game.href}
          className={styles.link}
          {...(current === game.id ? { "aria-current": "page" as const } : {})}
        >
          {game.title}
        </AppLink>
      ))}
    </nav>
  );
};
