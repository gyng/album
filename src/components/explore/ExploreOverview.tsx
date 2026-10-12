import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { Caption, Card, Heading, Pill } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreOverview.module.css";
import type { OverviewCard } from "./exploreViewModel";

const sectionGroups = [
  { label: "Visuals", ids: ["#embedding-space", "#visual-sameness", "#colour"] },
  {
    label: "Archive",
    ids: [
      "#fun-stats",
      "#recent-trends",
      "#revisited-places",
      "#when-you-shoot",
      "#where-you-shoot",
    ],
  },
  { label: "Photography", ids: ["#what-you-shoot-with", "#how-you-shoot", "#framing", "#weather"] },
];

const styles = mergeCssModuleStyles(sharedStyles, localStyles, [
  "header",
  "headerBody",
  "jumpNav",
  "jumpNavLink",
  "jumpNavLinks",
  "jumpNavGroup",
  "jumpNavGroups",
  "overview",
  "overviewValue",
  "title",
]);

export const ExploreOverview = ({
  sectionLinks,
  cards,
}: {
  sectionLinks: ReadonlyArray<{ href: string; label: string }>;
  cards: OverviewCard[];
}) => (
  <>
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

    <nav className={styles.jumpNav} aria-label="Jump to section">
      <div className={styles.jumpNavGroups}>
        {sectionGroups.map((group) => (
          <div key={group.label} className={styles.jumpNavGroup}>
            <Caption as="span">{group.label}</Caption>
            <div className={styles.jumpNavLinks}>
              {sectionLinks
                .filter((link) => group.ids.includes(link.href))
                .map((link) => (
                  <Pill key={link.href} href={link.href} className={styles.jumpNavLink}>
                    {link.label}
                  </Pill>
                ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  </>
);
