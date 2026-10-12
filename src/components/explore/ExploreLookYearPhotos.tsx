import { useState } from "react";
import type { VisualSamenessStats } from "../../util/computeEmbeddingStats";
import { PillButton } from "../ui";
import { VisualSimilarityThumb } from "./ExplorePrimitives";
import sharedStyles from "./ExploreShared.module.css";
import styles from "./ExploreLookYearPhotos.module.css";

export const ExploreLookYearPhotos = ({
  year,
  photos,
}: {
  year: number;
  photos: VisualSamenessStats["lookTimeline"][number]["photos"];
}) => {
  const [visible, setVisible] = useState(3);
  const [offset, setOffset] = useState(0);
  if (!photos.length) return null;
  const shown = Array.from(
    { length: Math.min(visible, photos.length) },
    (_, index) => photos[(offset + index) % photos.length]!,
  );
  const hasMore = visible < photos.length;
  return (
    <div className={styles.content}>
      <div id={`look-year-${year}-photos`} className={sharedStyles.visualTimelineThumbs}>
        {shown.map((photo) => (
          <VisualSimilarityThumb
            key={photo.path}
            photo={photo}
            className={sharedStyles.visualTimelineThumbWrap!}
            imageClassName={`${sharedStyles.visualEraThumb} ${sharedStyles.visualTimelineThumb}`}
          />
        ))}
      </div>
      {hasMore ? (
        <div className={styles.actions}>
          <PillButton
            size="compact"
            aria-label={`More photos from ${year}`}
            aria-controls={`look-year-${year}-photos`}
            onClick={() => setVisible((count) => Math.min(count + 3, photos.length))}
          >
            More
          </PillButton>
          <PillButton
            size="compact"
            aria-label={`Random photos from ${year}`}
            aria-controls={`look-year-${year}-photos`}
            onClick={() =>
              setOffset(
                (value) =>
                  (value + 1 + Math.floor(Math.random() * (photos.length - 1))) % photos.length,
              )
            }
          >
            Random
          </PillButton>
        </div>
      ) : null}
    </div>
  );
};
