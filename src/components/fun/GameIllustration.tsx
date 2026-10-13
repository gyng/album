import { useId, type ReactNode } from "react";
import { FUN_GAMES, type FunPage } from "./games";
import styles from "./GameIllustration.module.css";
import { useGameReadiness } from "./GameReadiness";
import { Button, LoadingIndicator } from "../ui";
import { ProgressBar } from "../ProgressBar";

export const GameIllustration = ({ src }: { src: string }) => {
  const id = useId();
  return (
    <svg className={styles.illustration} viewBox="0 0 960 640" aria-hidden="true">
      <defs>
        <filter id={`${id}-negative`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0" />
        </filter>
        <mask
          id={`${id}-ink`}
          className={styles.inkMask}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="960"
          height="640"
        >
          <image href={src} width="960" height="640" filter={`url(#${id}-negative)`} />
        </mask>
      </defs>
      <rect width="960" height="640" fill="currentColor" mask={`url(#${id}-ink)`} />
    </svg>
  );
};

export const GameIntro = ({
  game,
  children,
}: {
  game: Exclude<FunPage, "fun">;
  children: ReactNode;
}) => {
  const { loading, showProgress, progress, error, retry } = useGameReadiness();
  return (
    <div className={styles.intro}>
      <div className={styles.artwork}>
        <GameIllustration src={FUN_GAMES.find((item) => item.id === game)!.illustration} />
      </div>
      <div className={styles.introBody}>
        <fieldset className={styles.controls} disabled={loading}>
          <legend className={styles.legend}>Game setup</legend>
          {children}
        </fieldset>
        <div className={styles.loadFeedback}>
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <Button onClick={retry}>Try again</Button>
            </div>
          ) : loading && showProgress ? (
            <div role="status" aria-busy="true">
              <LoadingIndicator label="Loading photographs…" />
              <ProgressBar progress={progress} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
