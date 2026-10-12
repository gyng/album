import { useEffect, useState } from "react";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { Button, Heading, buttonStyles } from "../../components/ui";
import { AppLink } from "../../components/platform";
import { ProgressBar } from "../../components/ProgressBar";
import { useDatabase, useEmbeddingsDatabase } from "../../components/database/useDatabase";
import { fetchPhotoGameArchive } from "../../components/search/api";
import { FUN_GAMES, type PhotoGameKind } from "../../components/fun/games";
import { PhotoRelay } from "../../components/fun/PhotoRelay";
import { BlindFrame } from "../../components/fun/BlindFrame";
import { PhotoOracle } from "../../components/fun/PhotoOracle";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { formatPageTitle } from "../../lib/seo";
import styles from "./PhotoGameScreen.module.css";

export const PhotoGameScreen = ({ game }: { game: PhotoGameKind }) => {
  const [database, progress, , databaseError, retryDatabase] = useDatabase();
  const needsVectors = game !== "oracle";
  const [embeddings, vectorProgress, , vectorError, retryVectors] =
    useEmbeddingsDatabase(needsVectors);
  const [photos, setPhotos] = useState<PhotoGamePhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const definition = FUN_GAMES.find((item) => item.id === game)!;
  useEffect(() => {
    let cancelled = false;
    setPhotos(null);
    setError(null);
    if (!database || (needsVectors && !embeddings)) return;
    void fetchPhotoGameArchive({
      database,
      ...(needsVectors && embeddings ? { embeddingsDatabase: embeddings } : {}),
      game,
    })
      .then((result) => {
        if (!cancelled) setPhotos(result);
      })
      .catch(() => {
        if (!cancelled) setError("The game photographs could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [database, embeddings, needsVectors, game, attempt]);
  const loadError =
    error ??
    (databaseError || (needsVectors && vectorError)
      ? "The game photographs could not be loaded."
      : null);
  return (
    <main id="main-content" className={styles.page}>
      <Seo
        title={formatPageTitle(definition.title)}
        description={definition.description}
        pathname={definition.href}
        jsonLd={[]}
      />
      <GlobalNav currentPage={game} hasPadding={false} />
      <header className={styles.header}>
        <Heading level={1} as="h1">
          {definition.title}
        </Heading>
      </header>
      <div className={styles.content}>
        {loadError ? (
          <div role="alert">
            <p>{loadError}</p>
            <Button
              onClick={() => {
                if (databaseError) retryDatabase();
                else if (needsVectors && vectorError) retryVectors();
                else setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
            <AppLink href="/fun" className={buttonStyles.base}>
              All games
            </AppLink>
          </div>
        ) : !photos ? (
          <div role="status">
            <p>Loading photographs…</p>
            <ProgressBar progress={needsVectors ? Math.min(progress, vectorProgress) : progress} />
          </div>
        ) : !photos.length ? (
          <div>
            <p>This archive does not have the photographs needed for this game yet.</p>
            <AppLink href="/fun" className={buttonStyles.base}>
              All games
            </AppLink>
          </div>
        ) : game === "relay" ? (
          <PhotoRelay photos={photos} />
        ) : game === "blind-frame" ? (
          <BlindFrame photos={photos} />
        ) : (
          <PhotoOracle photos={photos} />
        )}
      </div>
    </main>
  );
};

export const PhotoRelayScreen = () => <PhotoGameScreen game="relay" />;
export const BlindFrameScreen = () => <PhotoGameScreen game="blind-frame" />;
export const PhotoOracleScreen = () => <PhotoGameScreen game="oracle" />;
