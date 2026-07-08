import { useCallback, useEffect, useRef, useState } from "react";
import { encodeSearchImage } from "./imageEmbeddings";

export type ImageQuerySource = "upload" | "drawing";

export type ImageQuery = {
  /** Monotonic id — keys the react-query cache entry, since the vector itself
   *  is far too large to serialise into a query key. */
  id: number;
  source: ImageQuerySource;
  /** Object URL for the chip thumbnail; revoked on clear/replace/unmount. */
  previewUrl: string;
  /** null while the vision model is still encoding the image. */
  vector: number[] | null;
};

type ProgressDetails = {
  loaded: number;
  total: number;
  file?: string;
};

export type ImageQueryState = {
  imageQuery: ImageQuery | null;
  imageVectorError: string | null;
  imageModelProgress: number;
  imageModelStage: string;
  imageModelProgressDetails: ProgressDetails;
  startImageQuery: (blob: Blob, source: ImageQuerySource) => void;
  clearImageQuery: () => void;
};

// An image query is ephemeral by design: the 768-dim vector can't round-trip
// through the URL the way text/colour/similar state does, so it lives only for
// the session and is dropped on navigation.
export const useImageQuery = (): ImageQueryState => {
  const [imageQuery, setImageQuery] = useState<ImageQuery | null>(null);
  const [imageVectorError, setImageVectorError] = useState<string | null>(null);
  const [imageModelProgress, setImageModelProgress] = useState(100);
  const [imageModelStage, setImageModelStage] = useState(
    "Loading image search model…",
  );
  const [imageModelProgressDetails, setImageModelProgressDetails] =
    useState<ProgressDetails>({ loaded: 0, total: 0 });
  const nextIdRef = useRef(0);
  const activeIdRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  const releasePreviewUrl = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  useEffect(() => releasePreviewUrl, []);

  const clearImageQuery = useCallback(() => {
    activeIdRef.current += 1;
    releasePreviewUrl();
    setImageQuery(null);
    setImageVectorError(null);
    setImageModelProgress(100);
    setImageModelProgressDetails({ loaded: 0, total: 0 });
  }, []);

  const startImageQuery = useCallback(
    (blob: Blob, source: ImageQuerySource) => {
      releasePreviewUrl();
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      nextIdRef.current += 1;
      const id = nextIdRef.current;
      activeIdRef.current = id;

      setImageVectorError(null);
      setImageModelProgress(0);
      setImageModelStage("Loading image search model…");
      setImageQuery({ id, source, previewUrl, vector: null });

      encodeSearchImage(blob, (progress, stage, details) => {
        if (activeIdRef.current !== id) {
          return;
        }
        setImageModelProgress(progress);
        setImageModelStage(stage);
        setImageModelProgressDetails(details ?? { loaded: 0, total: 0 });
      })
        .then((vector) => {
          if (activeIdRef.current !== id) {
            return;
          }
          setImageModelProgress(100);
          setImageQuery((current) =>
            current?.id === id ? { ...current, vector } : current,
          );
        })
        .catch((err) => {
          if (activeIdRef.current !== id) {
            return;
          }
          console.error("Failed to encode search image", err);
          releasePreviewUrl();
          setImageModelProgress(100);
          setImageQuery(null);
          setImageVectorError("Image search is unavailable right now.");
        });
    },
    [],
  );

  return {
    imageQuery,
    imageVectorError,
    imageModelProgress,
    imageModelStage,
    imageModelProgressDetails,
    startImageQuery,
    clearImageQuery,
  };
};
