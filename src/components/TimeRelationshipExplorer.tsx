import { useState } from "react";
import {
  NumericFacetStat,
  ParallelRelationshipData,
} from "../util/computeStats";
import { TechnicalHeatmaps } from "./TechnicalHeatmaps";
import { TimeOfDayChart } from "./TimeOfDayChart";
import { Caption } from "./ui";
import styles from "./TimeRelationshipExplorer.module.css";

type Props = {
  hourFacet: NumericFacetStat;
  relationships: ParallelRelationshipData;
  formatCoverage: (coverage: number) => string;
};

export const TimeRelationshipExplorer: React.FC<Props> = ({
  hourFacet,
  relationships,
  formatCoverage,
}) => {
  const [activeHour, setActiveHour] = useState<string | null>(null);

  return (
    <div className={styles.wrapper}>
      <section className={styles.block}>
        <div className={styles.header}>
          <h2 className={styles.title}>{hourFacet.displayName}</h2>
          <Caption as="span">
            {formatCoverage(hourFacet.coverage)}
          </Caption>
        </div>
        {hourFacet.coverage === 0 ? (
          <Caption size="sm">No data available.</Caption>
        ) : (
          <TimeOfDayChart
            data={hourFacet.data}
            activeLabel={activeHour}
            onActivate={setActiveHour}
            onDeactivate={() => {
              setActiveHour(null);
            }}
          />
        )}
      </section>

      <section className={styles.block}>
        <div className={styles.header}>
          <h2 className={styles.title}>Time relationships</h2>
          <Caption as="span">
            Based on {relationships.total.toLocaleString()} photos with local
            time, aperture, and ISO
          </Caption>
        </div>
        <TechnicalHeatmaps
          data={relationships}
          pairs={[
            [0, 1],
            [0, 2],
          ]}
          titles={{
            "0-1": "Time of day × Aperture",
            "0-2": "Time of day × ISO",
          }}
          layout="two-up"
          activeXAxisBucket={activeHour}
          caption="Hover a square to trace how each time-of-day band distributes across aperture and ISO, or hover an hour above to highlight that column in both heatmaps."
        />
      </section>
    </div>
  );
};
