import { AppLink } from "../platform";
import styles from "./ExploreSubnav.module.css";
const views = [
  { id: "explore", href: "/explore", label: "Overview" },
  { id: "timeline", href: "/explore/timeline", label: "Timeline" },
  { id: "trips", href: "/explore/trips", label: "Trips" },
] as const;
export const ExploreSubnav = ({ current }: { current: "explore" | "timeline" | "trips" }) => (
  <nav className={styles.nav} aria-label="Explore views">
    {views.map((view) => (
      <AppLink
        key={view.id}
        href={view.href}
        className={styles.link}
        {...(current === view.id ? { "aria-current": "page" as const } : {})}
      >
        {view.label}
      </AppLink>
    ))}
  </nav>
);
