import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import { SearchDrawPad } from "../search/SearchDrawPad";
import { useImageQuery } from "../search/useImageQuery";
import { ProgressBar } from "../ProgressBar";
import { rankDrawing, shuffleGamePhotos, type PhotoGamePhoto } from "../../util/photoGames";
import { GamePhoto } from "./GamePhoto";
import styles from "./PhotoGames.module.css";

export const BlindFrame = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [target, setTarget] = useState<PhotoGamePhoto | null>(null);
  const [drawing, setDrawing] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const previousTarget = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLQuoteElement>(null);
  useEffect(() => {
    if (target) promptRef.current?.focus();
  }, [target]);
  const {
    imageQuery,
    imageVectorError,
    imageModelStage,
    imageModelProgress,
    startImageQuery,
    clearImageQuery,
  } = useImageQuery();
  const result = useMemo(
    () =>
      target && imageQuery?.vector ? rankDrawing(imageQuery.vector, photos, target.path) : null,
    [target, imageQuery, photos],
  );
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);
  const eligible = photos.filter((photo) => photo.caption.length >= 20 && photo.vector.length > 0);
  const start = () => {
    const next =
      shuffleGamePhotos(eligible.filter((photo) => photo.path !== previousTarget.current))[0] ??
      eligible[0]!;
    previousTarget.current = next.path;
    setTarget(next);
    clearImageQuery();
    blobRef.current = null;
    setDrawing(false);
  };
  if (!eligible.length)
    return (
      <p>
        Blind Frame needs photographs with AI descriptions and drawing-compatible image similarity
        data.
      </p>
    );
  if (!target)
    return (
      <div className={styles.game}>
        <p>
          Sketch a hidden photograph from its AI description. Afterwards, see the original and the
          photograph most closely matched by your drawing.
        </p>
        <Button variant="primary" onClick={start}>
          Start Blind Frame
        </Button>
      </div>
    );
  return (
    <div className={styles.game}>
      <blockquote className={styles.prompt} ref={promptRef} tabIndex={-1}>
        {target.caption}
      </blockquote>
      {result && imageQuery ? (
        <div
          className={styles.result}
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="Blind Frame result"
        >
          <Heading level={1}>The reveal</Heading>
          <p className={styles.score}>{result.score} / 100</p>
          <Caption>
            The hidden photograph ranked {result.rank.toLocaleString("en-GB")} of{" "}
            {result.total.toLocaleString("en-GB")} archive matches for your sketch. The score
            follows that rank.
          </Caption>
          <div className={styles.comparison}>
            <figure className={styles.frame}>
              <Caption as="span">Your sketch</Caption>
              <img
                className={styles.photo}
                src={imageQuery.previewUrl}
                alt="Your submitted sketch"
              />
            </figure>
            <figure className={styles.frame}>
              <Caption as="span">Hidden photograph</Caption>
              <GamePhoto photo={target} link />
            </figure>
            <figure className={styles.frame}>
              <Caption as="span">Closest archive match</Caption>
              <GamePhoto photo={result.nearest} link />
            </figure>
          </div>
          <Button variant="primary" onClick={start}>
            Play again
          </Button>
        </div>
      ) : (
        <>
          {imageQuery && !imageQuery.vector ? (
            <div role="status">
              <p>{imageModelStage}</p>
              <ProgressBar progress={imageModelProgress} />
            </div>
          ) : null}
          {imageVectorError ? (
            <div role="alert">
              <p>{imageVectorError}</p>
              <Button
                onClick={() => {
                  if (blobRef.current) startImageQuery(blobRef.current, "drawing");
                }}
              >
                Retry this sketch
              </Button>
            </div>
          ) : null}
          {imageQuery?.vector && !result ? (
            <p role="alert">
              The sketch could not be compared with this archive. Try another sketch.
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={!!imageQuery && !imageQuery.vector}
              onClick={() => setDrawing(true)}
            >
              Draw this scene
            </Button>
            <Button variant="quiet" onClick={start}>
              Another description
            </Button>
          </div>
        </>
      )}
      {drawing ? (
        <SearchDrawPad
          title="Blind Frame sketch"
          description={target.caption}
          submitLabel="Reveal the photograph"
          onCancel={() => setDrawing(false)}
          onSubmit={(blob) => {
            blobRef.current = blob;
            setDrawing(false);
            startImageQuery(blob, "drawing");
          }}
        />
      ) : null}
    </div>
  );
};
