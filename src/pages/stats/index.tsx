import type { GetStaticProps, NextPage } from "next";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { StatBar } from "../../components/StatBar";
import { getAlbums } from "../../services/album";
import { computePhotoStats, PhotoStats } from "../../util/computeStats";
import { measureBuild } from "../../services/buildTiming";
import styles from "./stats.module.css";

type PageProps = {
  stats: PhotoStats;
};

const formatCoverage = (coverage: number): string =>
  `${Math.round(coverage * 100)}% of photos`;

const StatSection: React.FC<{
  title: string;
  coverage: number;
  children: React.ReactNode;
}> = ({ title, coverage, children }) => (
  <section className={styles.section}>
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <span className={styles.coverage}>{formatCoverage(coverage)}</span>
    </div>
    {coverage === 0 ? (
      <p className={styles.noData}>No data available.</p>
    ) : (
      <div className={styles.bars}>{children}</div>
    )}
  </section>
);

const StatsPage: NextPage<PageProps> = ({ stats }) => {
  return (
    <div className={styles.page}>
      <Seo
        title="Stats | Snapshots"
        description="Shooting statistics and gear breakdown."
        pathname="/stats"
        jsonLd={[]}
      />

      <main className={styles.main}>
        <GlobalNav currentPage="stats" hasPadding={false} />

        <header className={styles.header}>
          <h1 className={styles.title}>Stats</h1>
          {stats.dateRange ? (
            <p className={styles.kicker}>
              {stats.totalPhotos.toLocaleString()} photos across{" "}
              {stats.totalAlbums} albums, {stats.dateRange[0]}–
              {stats.dateRange[1]}
            </p>
          ) : (
            <p className={styles.kicker}>
              {stats.totalPhotos.toLocaleString()} photos across{" "}
              {stats.totalAlbums} albums
            </p>
          )}
        </header>

        <div className={styles.grid}>
          {stats.numericFacets.map((facet) => {
            const max = Math.max(...facet.data.map((b) => b.count), 1);
            const hasData = facet.data.some((b) => b.count > 0);
            if (!hasData && facet.coverage === 0) return null;

            return (
              <StatSection
                key={facet.facetId}
                title={facet.displayName}
                coverage={facet.coverage}
              >
                {facet.data.map((bucket) => (
                  <StatBar
                    key={bucket.label}
                    label={bucket.label}
                    count={bucket.count}
                    maxCount={max}
                    totalPhotos={stats.totalPhotos}
                  />
                ))}
              </StatSection>
            );
          })}

          {stats.stringFacets.map((facet) => {
            if (facet.data.length === 0) return null;
            const max = Math.max(...facet.data.map((b) => b.count), 1);

            return (
              <StatSection
                key={facet.facetId}
                title={facet.displayName}
                coverage={facet.coverage}
              >
                {facet.data.map((bucket) => (
                  <StatBar
                    key={bucket.label}
                    label={bucket.label}
                    count={bucket.count}
                    maxCount={max}
                    totalPhotos={stats.totalPhotos}
                  />
                ))}
              </StatSection>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => {
  return measureBuild("page./stats.getStaticProps", async () => {
    const albums = await getAlbums();
    const stats = computePhotoStats(albums);
    return { props: { stats } };
  });
};

export default StatsPage;
