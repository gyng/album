import { Caption, Card, Heading, Pill } from "../ui";
import styles from "../../pages/explore/explore.module.css";
import type { OverviewCard } from "./exploreViewModel";

export const ExploreOverview = ({
  sectionLinks,
  cards,
}: {
  sectionLinks: ReadonlyArray<{ href: string; label: string }>;
  cards: OverviewCard[];
}) => (
  <>
    <nav className={styles.jumpNav} aria-label="Jump to section">
      <Caption as="span">Jump to</Caption>
      <div className={styles.jumpNavLinks}>
        {sectionLinks.map((link) => (
          <Pill key={link.href} href={link.href} className={styles.jumpNavLink}>
            {link.label}
          </Pill>
        ))}
      </div>
    </nav>

    <header className={styles.header}>
      <div className={styles.headerBody}>
        <Heading level={1} as="h1" className={styles.title}>
          Explore
        </Heading>
      </div>
    </header>

    <section className={styles.overview}>
      {cards.map((card) => (
        <Card key={card.label} className={styles.overviewCard}>
          <Caption as="div">{card.label}</Caption>
          <div className={styles.overviewValue}>{card.value}</div>
        </Card>
      ))}
    </section>
  </>
);
