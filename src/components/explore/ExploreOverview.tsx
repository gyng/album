import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { Caption, Heading, Pill } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreOverview.module.css";

const sectionGroups = [
  { label: "Visuals", ids: ["#embedding-space", "#visual-sameness", "#video", "#colour"] },
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
  "title",
]);

export const ExploreOverview = ({
  sectionLinks,
}: {
  sectionLinks: ReadonlyArray<{ href: string; label: string }>;
}) => (
  <>
    <header className={styles.header}>
      <div className={styles.headerBody}>
        <Heading level={1} as="h1" className={styles.title}>
          Explore
        </Heading>
      </div>
    </header>

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
