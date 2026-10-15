import { useEffect, useMemo, useState } from "react";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { Heading, buttonStyles } from "../../components/ui";
import { AppLink } from "../../components/platform";
import { useDatabase, useEmbeddingsDatabase } from "../../components/database/useDatabase";
import { fetchPhotoGameArchive } from "../../components/search/api";
import { FUN_GAMES, type PhotoGameKind } from "../../components/fun/games";
import { PhotoPairs } from "../../components/fun/PhotoPairs";
import { PhotoJigsaw } from "../../components/fun/PhotoJigsaw";
import { PhotoRelay } from "../../components/fun/PhotoRelay";
import { BlindFrame } from "../../components/fun/BlindFrame";
import { PhotoConnections } from "../../components/fun/PhotoConnections";
import { PhotoHangman } from "../../components/fun/PhotoHangman";
import { SightLines } from "../../components/fun/SightLines";
import { PhotoCrossword } from "../../components/fun/PhotoCrossword";
import { DoubleTake } from "../../components/fun/DoubleTake";
import { Hindsight } from "../../components/fun/Hindsight";
import { GameReadinessProvider } from "../../components/fun/GameReadiness";
import { PhotoOracle } from "../../components/fun/PhotoOracle";
import { Warmer } from "../../components/fun/Warmer";
import { CaptionIt } from "../../components/fun/CaptionIt";
import type { PhotoGamePhoto } from "../../util/photoGames";
import { formatPageTitle } from "../../lib/seo";
import styles from "./PhotoGameScreen.module.css";

const EMPTY_PHOTOS: PhotoGamePhoto[] = [];

export const PhotoGameScreen = ({ game }: { game: PhotoGameKind }) => {
  const [database, progress, , databaseError, retryDatabase] = useDatabase();
  const needsVectors =
    game === "photo-pairs" ||
    game === "relay" ||
    game === "blind-frame" ||
    game === "double-take" ||
    game === "warmer" ||
    game === "caption-it";
  const [embeddings, vectorProgress, , vectorError, retryVectors] =
    useEmbeddingsDatabase(needsVectors);
  const [attempt, setAttempt] = useState(0);
  // One load per combination of these; its result and error belong to it alone,
  // so a new game, database or retry starts with neither.
  const request = useMemo(
    () => ({ database, embeddings, needsVectors, game, attempt }),
    [database, embeddings, needsVectors, game, attempt],
  );
  const [loaded, setLoaded] = useState<{ request: object; photos: PhotoGamePhoto[] } | null>(null);
  const photos = loaded?.request === request ? loaded.photos : null;
  const [failed, setFailed] = useState<{ request: object; error: string } | null>(null);
  const error = failed?.request === request ? failed.error : null;
  const [loadingShownFor, setLoadingShownFor] = useState<object | null>(null);
  const availablePhotos = photos ?? EMPTY_PHOTOS;
  const definition = FUN_GAMES.find((item) => item.id === game)!;
  useEffect(() => {
    let cancelled = false;
    const { database, embeddings, needsVectors, game } = request;
    if (!database || (needsVectors && !embeddings)) return;
    void fetchPhotoGameArchive({
      database,
      ...(needsVectors && embeddings ? { embeddingsDatabase: embeddings } : {}),
      game,
    })
      .then((result) => {
        if (!cancelled) setLoaded({ request, photos: result });
      })
      .catch(() => {
        if (!cancelled) setFailed({ request, error: "The game photographs could not be loaded." });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);
  const loadError =
    error ??
    (databaseError || (needsVectors && vectorError)
      ? "The game photographs could not be loaded."
      : null);
  // Shown only once this load has taken a moment, so a quick one never flashes it.
  const loadingVisible = !photos && !loadError && loadingShownFor === request;
  useEffect(() => {
    if (photos || loadError) return;
    const timer = window.setTimeout(() => setLoadingShownFor(request), 180);
    return () => window.clearTimeout(timer);
  }, [photos, loadError, request]);
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
        <GameReadinessProvider
          value={{
            loading: !photos || Boolean(loadError),
            showProgress: loadingVisible,
            progress: needsVectors ? Math.min(progress, vectorProgress) : progress,
            error: loadError,
            retry: () => {
              if (databaseError) retryDatabase();
              else if (needsVectors && vectorError) retryVectors();
              else setAttempt((value) => value + 1);
            },
          }}
        >
          {photos && !photos.length ? (
            <div>
              <p>This archive does not have the photographs needed for this game yet.</p>
              <AppLink href="/fun" className={buttonStyles.base}>
                All games
              </AppLink>
            </div>
          ) : game === "photo-pairs" ? (
            <PhotoPairs photos={availablePhotos} />
          ) : game === "photo-jigsaw" ? (
            <PhotoJigsaw photos={availablePhotos} />
          ) : game === "relay" ? (
            <PhotoRelay photos={availablePhotos} />
          ) : game === "blind-frame" ? (
            <BlindFrame photos={availablePhotos} />
          ) : game === "double-take" ? (
            <DoubleTake photos={availablePhotos} />
          ) : game === "cross-exposure" ? (
            <PhotoCrossword photos={availablePhotos} />
          ) : game === "sight-lines" ? (
            <SightLines photos={availablePhotos} />
          ) : game === "photo-hangman" ? (
            <PhotoHangman photos={availablePhotos} />
          ) : game === "hindsight" ? (
            <Hindsight photos={availablePhotos} />
          ) : game === "warmer" ? (
            <Warmer photos={availablePhotos} />
          ) : game === "caption-it" ? (
            <CaptionIt photos={availablePhotos} />
          ) : game === "connections" ? (
            <PhotoConnections photos={availablePhotos} />
          ) : (
            <PhotoOracle photos={availablePhotos} />
          )}
        </GameReadinessProvider>
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

export const PhotoHangmanScreen = () => <PhotoGameScreen game="photo-hangman" />;

export const HindsightScreen = () => <PhotoGameScreen game="hindsight" />;

export const WarmerScreen = () => <PhotoGameScreen game="warmer" />;

export const CaptionItScreen = () => <PhotoGameScreen game="caption-it" />;

export const PhotoPairsScreen = () => <PhotoGameScreen game="photo-pairs" />;
export const PhotoJigsawScreen = () => <PhotoGameScreen game="photo-jigsaw" />;
