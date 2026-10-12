import { useState } from "react";
import type { VisualSamenessStats } from "../../util/computeEmbeddingStats";
import { Caption, Heading, PillButton } from "../ui";
import { VisualSimilarityThumb } from "./ExplorePrimitives";
import { usePhotoRowCapacity } from "./usePhotoRowCapacity";
import styles from "./ExploreShared.module.css";

type Props =
  | { kind: "repeated"; examples: VisualSamenessStats["repeatedExamples"] }
  | { kind: "travelling"; examples: VisualSamenessStats["travellingMotifs"] };

export const ExplorePairExamples = ({ kind, examples }: Props) => {
  const { ref, capacity } = usePhotoRowCapacity("rendered", 1);
  const [rows, setRows] = useState(3);
  if (!examples.length) return null;
  const shown = examples.slice(0, rows * capacity);
  return (
    <section className={`${styles.visualExampleSection} ${styles.visualFullRowSection}`}>
      <div className={styles.sectionHeader}>
        <Heading level={2}>
          {kind === "repeated" ? "Repeated motifs" : "Same look, different place"}
        </Heading>
        <Caption as="span">
          {kind === "repeated"
            ? "Closest recurring visual matches"
            : "The closest match each of these found somewhere else"}
        </Caption>
      </div>
      <div ref={ref} className={styles.visualPairs}>
        {shown.map((example) => (
          <div key={`${example.left.path}-${example.right.path}`} className={styles.visualPairCard}>
            <div className={styles.visualPairImages}>
              <VisualSimilarityThumb photo={example.left} />
              <VisualSimilarityThumb photo={example.right} />
            </div>
            <div className={styles.visualExampleMeta}>
              <span>{example.similarityPercent}% match</span>
              {kind === "travelling" && "place" in example.left && "place" in example.right ? (
                <span className={styles.travellingPlaces}>
                  {String(example.left.place)} → {String(example.right.place)}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {examples.length > shown.length ? (
        <PillButton
          size="compact"
          className={styles.loadMoreButton}
          onClick={() => setRows((count) => count + 1)}
        >
          {kind === "repeated" ? "Load more repeated motifs" : "Load more travelling looks"}
        </PillButton>
      ) : null}
    </section>
  );
};
