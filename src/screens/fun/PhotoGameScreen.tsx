import { useEffect, useState } from "react";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { Button, Heading, LoadingIndicator, buttonStyles } from "../../components/ui";
import { AppLink } from "../../components/platform";
import { ProgressBar } from "../../components/ProgressBar";
import { useDatabase, useEmbeddingsDatabase } from "../../components/database/useDatabase";
import { fetchPhotoGameArchive } from "../../components/search/api";
import { FUN_GAMES, type PhotoGameKind } from "../../components/fun/games";
import { PhotoRelay } from "../../components/fun/PhotoRelay";
import { BlindFrame } from "../../components/fun/BlindFrame";
import { PhotoConnections } from "../../components/fun/PhotoConnections";
import { SightLines } from "../../components/fun/SightLines";
import { PhotoCrossword } from "../../components/fun/PhotoCrossword";
import { DoubleTake } from "../../components/fun/DoubleTake";
import { GameIntro } from "../../components/fun/GameIllustration";
import { PhotoOracle } from "../../components/fun/PhotoOracle";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { formatPageTitle } from "../../lib/seo";
import styles from "./PhotoGameScreen.module.css";

export const PhotoGameScreen = ({ game }: { game: PhotoGameKind }) => {
  const [database, progress, , databaseError, retryDatabase] = useDatabase();
  const needsVectors = game === "relay" || game === "blind-frame" || game === "double-take";
  const [embeddings, vectorProgress, , vectorError, retryVectors] =
    useEmbeddingsDatabase(needsVectors);
  const [loaded, setLoaded] = useState<{ game: PhotoGameKind; photos: PhotoGamePhoto[] } | null>(
    null,
  );
  const photos = loaded?.game === game ? loaded.photos : null;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingVisible, setLoadingVisible] = useState(false);
  const definition = FUN_GAMES.find((item) => item.id === game)!;
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    if (!database || (needsVectors && !embeddings)) return;
    void fetchPhotoGameArchive({
      database,
      ...(needsVectors && embeddings ? { embeddingsDatabase: embeddings } : {}),
      game,
    })
      .then((result) => {
        if (!cancelled) setLoaded({ game, photos: result });
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
  useEffect(() => {
    setLoadingVisible(false);
    if (photos || loadError) return;
    const timer = window.setTimeout(() => setLoadingVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [photos, loadError, game]);
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
          <GameIntro game={game}>
            <p>{definition.description}</p>
            {loadingVisible ? (
              <div role="status" aria-busy="true">
                <LoadingIndicator label="Loading photographs…" />
                <ProgressBar
                  progress={needsVectors ? Math.min(progress, vectorProgress) : progress}
                />
              </div>
            ) : null}
          </GameIntro>
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
        ) : game === "double-take" ? (
          <DoubleTake photos={photos} />
        ) : game === "cross-exposure" ? (
          <PhotoCrossword photos={photos} />
        ) : game === "sight-lines" ? (
          <SightLines photos={photos} />
        ) : game === "connections" ? (
          <PhotoConnections photos={photos} />
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

export const PhotoConnectionsScreen = () => <PhotoGameScreen game="connections" />;

export const DoubleTakeScreen = () => <PhotoGameScreen game="double-take" />;

export const PhotoCrosswordScreen = () => <PhotoGameScreen game="cross-exposure" />;

export const SightLinesScreen = () => <PhotoGameScreen game="sight-lines" />;
