import { AppLink } from "../platform";
import { buttonStyles } from "../ui";
import { guessWherePath } from "../guess/guessPhotoLinks";
import styles from "./ResultNextSteps.module.css";

export type NextStepPhoto = {
  /** The archive path, `../albums/<album>/<file>`, as the search database keys it. */
  path: string;
  /** Present when the photograph has coordinates; only these can be dealt to Guess Where. */
  location?: { lat: number; lng: number } | undefined;
};

/**
 * Where a finished game's photographs can lead: search for more like one of
 * them, or guess where they were taken.
 */
export const ResultNextSteps = ({
  photos,
  similarTo = photos[0]?.path,
}: {
  photos: readonly NextStepPhoto[];
  /** The photograph to search around; the first one when omitted. */
  similarTo?: string | undefined;
}) => {
  const located = photos.filter((photo) => photo.location).map((photo) => photo.path);
  if (!similarTo && located.length < 2) return null;
  return (
    <nav className={styles.steps} aria-label="Next steps">
      {similarTo ? (
        <AppLink
          href={`/search?similar=${encodeURIComponent(similarTo)}`}
          className={buttonStyles.base}
        >
          Similar photographs
        </AppLink>
      ) : null}
      {located.length >= 2 ? (
        <AppLink href={guessWherePath(located)} className={buttonStyles.base}>
          Guess where these were taken
        </AppLink>
      ) : null}
    </nav>
  );
};
