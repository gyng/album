import React from "react";
import styles from "./Search.module.css";
import { ProgressBar } from "../ProgressBar";
import { SearchTag } from "./SearchTag";
import { similarSearchEmojiStyle, Tag } from "./searchUtils";

const SharedTagsCaption = () => (
  <>
    keep stacking keywords to narrow results, or click{" "}
    <span style={similarSearchEmojiStyle}>🔍</span> to find similar photos
  </>
);

type Props = {
  databaseProgressDetails?: { loaded: number; total: number };
  normalizedSearchTerms: string[];
  normalizedTags: Tag[];
  progress: number;
  refinementCounts: Record<string, number>;
  onToggleTag: (tagName: string, isActive: boolean) => void;
};

export const SearchRefinementSection: React.FC<Props> = ({
  databaseProgressDetails,
  normalizedSearchTerms,
  normalizedTags,
  progress,
  refinementCounts,
  onToggleTag,
}) => {
  return (
    <section>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionCaption}>
          <SharedTagsCaption />
        </div>
      </div>
      <ProgressBar progress={progress} details={databaseProgressDetails} />
      <div className={styles.tagsContainer}>
        {normalizedTags.map((tag) => {
          const isActive = normalizedSearchTerms.includes(tag.name);
          const refinementCount = refinementCounts[tag.name];
          const isDisabled = !isActive && refinementCount === 0;
          const visibleCount =
            !isActive && refinementCount !== undefined
              ? refinementCount
              : tag.count - 1;
          return (
            <SearchTag
              key={tag.name}
              tag={tag.name}
              count={visibleCount}
              isActive={isActive}
              disabled={isDisabled}
              onClick={() => {
                onToggleTag(tag.name, isActive);
              }}
            />
          );
        })}
      </div>
    </section>
  );
};
