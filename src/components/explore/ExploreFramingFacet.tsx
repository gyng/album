import { useState } from "react";
import type { StringFacetStat } from "../../util/computeStats";
import { StatBar } from "../StatBar";
import { PillButton } from "../ui";
import { ExploreStatSection } from "./ExplorePrimitives";
import styles from "./ExploreFramingFacet.module.css";

const FrameIcon = ({ label }: { label: string }) => {
  const parts = label.replace("≈", "").split(":").map(Number);
  const ratio =
    label === "Landscape"
      ? 1.5
      : label === "Portrait"
        ? 2 / 3
        : label === "Square"
          ? 1
          : (parts[0] ?? 1) / (parts[1] ?? 1);
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? Math.max(0.2, Math.min(5, ratio)) : 1;
  const width = safeRatio >= 1 ? 18 : 18 * safeRatio;
  const height = safeRatio >= 1 ? 18 / safeRatio : 18;
  return (
    <svg className={styles.frame} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x={(24 - width) / 2} y={(24 - height) / 2} width={width} height={height} rx="1" />
    </svg>
  );
};

export const ExploreFramingFacet = ({ facet }: { facet: StringFacetStat }) => {
  const [expanded, setExpanded] = useState(false);
  if (!facet.data.length) return null;
  const collapsible = facet.facetId === "aspect-ratio" && facet.data.length > 5;
  const visible = collapsible && !expanded ? facet.data.slice(0, 5) : facet.data;
  const max = Math.max(...facet.data.map((bucket) => bucket.count), 1);
  return (
    <ExploreStatSection facetId={facet.facetId} title={facet.displayName} coverage={facet.coverage}>
      <div id={`${facet.facetId}-buckets`} className={styles.buckets}>
        {visible.map((bucket) => (
          <StatBar
            key={bucket.label}
            label={bucket.label}
            labelPrefix={<FrameIcon label={bucket.label} />}
            count={bucket.count}
            maxCount={max}
          />
        ))}
      </div>
      {collapsible ? (
        <PillButton
          size="compact"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={`${facet.facetId}-buckets`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Less" : `More (${facet.data.length - 5})`}
        </PillButton>
      ) : null}
    </ExploreStatSection>
  );
};
