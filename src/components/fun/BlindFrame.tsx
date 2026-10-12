import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Caption, Heading } from "../ui";
import { SearchDrawPad } from "../search/SearchDrawPad";
import { useImageQuery } from "../search/useImageQuery";
import { ProgressBar } from "../ProgressBar";
import {
  nearestGamePhotos,
  rankDrawing,
  shuffleGamePhotos,
  type PhotoGamePhoto,
} from "../../util/photoGames";
import { GameScore } from "./GameFeedback";
import { GamePhoto, PhotoChain } from "./GamePhoto";
import { GameIntro } from "./GameIllustration";
import styles from "./PhotoGames.module.css";

export const BlindFrame = ({ photos }: { photos: PhotoGamePhoto[] }) => {
  const [target, setTarget] = useState<PhotoGamePhoto | null>(null);
  const [inlinePad, setInlinePad] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 721px)");
    const update = () => setInlinePad(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [drawing, setDrawing] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const roundRef = useRef(0);
  const round = roundRef.current;
  const blobRef = useRef<Blob | null>(null);
  const previousTarget = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLQuoteElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (imageVectorError || (imageQuery && !imageQuery.vector)) feedbackRef.current?.focus();
  }, [imageVectorError, imageQuery]);
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
    roundRef.current += 1;
    const next =
      shuffleGamePhotos(eligible.filter((photo) => photo.path !== previousTarget.current))[0] ??
      eligible[0]!;
    previousTarget.current = next.path;
    setTarget(next);
    clearImageQuery();
    blobRef.current = null;
    setDrawing(false);
    setGaveUp(false);
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
      <GameIntro game="blind-frame">
        <p>
          Sketch a hidden photograph from its AI description. Afterwards, see the original and the
          photograph most closely matched by your drawing.
        </p>
        <Button variant="primary" onClick={start}>
          Start Blind Frame
        </Button>
      </GameIntro>
    );
  return (
    <div className={styles.game}>
      <blockquote className={styles.prompt} ref={promptRef} tabIndex={-1}>
        {target.caption}
      </blockquote>
      {(result && imageQuery) || gaveUp ? (
        <div
          className={styles.result}
          ref={resultRef}
          tabIndex={-1}
          role="region"
          aria-label="Blind Frame result"
        >
          <Heading level={1}>The reveal</Heading>
          {result && !gaveUp ? (
            <>
              <GameScore label="" score={result.score} />
              <Caption>
                The hidden photograph ranked {result.rank.toLocaleString("en-GB")} of{" "}
                {result.total.toLocaleString("en-GB")} archive matches for your sketch. The score
                compares its similarity with the closest and typical matches.
              </Caption>
            </>
          ) : null}
          <div
            className={[styles.comparison, gaveUp ? styles.comparisonSingle : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {imageQuery && !gaveUp ? (
              <>
                <figure className={styles.frame}>
                  <Caption as="figcaption">Your sketch</Caption>
                  <img
                    className={styles.photo}
                    src={imageQuery.previewUrl}
                    alt="Your submitted sketch"
                  />
                </figure>
              </>
            ) : null}
            <figure className={styles.frame}>
              <Caption as="figcaption">Hidden photograph</Caption>
              <GamePhoto photo={target} link />
            </figure>
            {result && !gaveUp ? (
              <figure className={styles.frame}>
                <Caption as="figcaption">Closest archive match</Caption>
                <GamePhoto photo={result.nearest} link />
              </figure>
            ) : null}
          </div>
          <section className={styles.result}>
            <Heading level={2}>Close to the hidden photograph</Heading>
            <PhotoChain photos={nearestGamePhotos(target, photos, 4)} />
          </section>
          <div className={styles.actions}>
            <Button variant="primary" onClick={start}>
              Play again
            </Button>
            <Button
              onClick={() => {
                clearImageQuery();
                setGaveUp(false);
                setDrawing(true);
              }}
            >
              Try this scene again
            </Button>
          </div>
        </div>
      ) : (
        <>
          {imageQuery && !imageQuery.vector ? (
            <div ref={feedbackRef} tabIndex={-1} role="status">
              <p>{imageModelStage}</p>
              <ProgressBar progress={imageModelProgress} />
            </div>
          ) : null}
          {imageVectorError ? (
            <div ref={feedbackRef} tabIndex={-1} role="alert">
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
            {!inlinePad ? (
              <Button
                variant="primary"
                disabled={!!imageQuery && !imageQuery.vector}
                onClick={() => setDrawing(true)}
              >
                Draw this scene
              </Button>
            ) : null}
            <Button variant="quiet" onClick={start}>
              Another description
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                clearImageQuery();
                setGaveUp(true);
              }}
            >
              Give up
            </Button>
          </div>
        </>
      )}
      {drawing || (inlinePad && !result && !gaveUp && !imageQuery) ? (
        <SearchDrawPad
          key={round}
          inline={inlinePad}
          title="Blind Frame sketch"
          {...(!inlinePad ? { description: target.caption } : {})}
          submitLabel="Reveal"
          cancelLabel="Close sketch"
          {...(blobRef.current ? { initialDrawing: blobRef.current } : {})}
          onDraft={(blob) => {
            if (round === roundRef.current) blobRef.current = blob;
          }}
          onCancel={() => setDrawing(false)}
          onSubmit={(blob) => {
            if (round !== roundRef.current) return;
            blobRef.current = blob;
            setDrawing(false);
            startImageQuery(blob, "drawing");
          }}
        />
      ) : null}
    </div>
  );
};
