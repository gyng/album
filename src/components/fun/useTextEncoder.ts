import { useCallback, useRef, useState } from "react";
import { encodeSearchText } from "../search/textEmbeddings";
import {
  isEmbeddingWorkerSlowStart,
  isEmbeddingWorkerUnavailable,
} from "../search/embeddingWorkerClient";

export type TextEncoderState = {
  /** Whether an encode is running (the first one includes the model download). */
  busy: boolean;
  progress: number;
  stage: string;
  error: string | null;
};

const failureMessage = (error: unknown) =>
  isEmbeddingWorkerUnavailable(error)
    ? "The language model could not start — the site may have been updated. Reload the page to try again."
    : isEmbeddingWorkerSlowStart(error)
      ? "The language model is taking a while to load — check the connection and try again."
      : "The words could not be compared with the photograph. Try again.";

/**
 * The search page's text encoder, for games. Nothing downloads until the first
 * encode: the model is far larger than the archive the game already loaded.
 * Returns null when encoding failed or a newer request replaced this one.
 */
export const useTextEncoder = () => {
  const [state, setState] = useState<TextEncoderState>({
    busy: false,
    progress: 100,
    stage: "",
    error: null,
  });
  const latest = useRef(0);
  // Once the model has answered, later encodes are a moment's work, not a download.
  const loaded = useRef(false);
  const encode = useCallback(async (text: string): Promise<number[] | null> => {
    const request = ++latest.current;
    setState(
      loaded.current
        ? { busy: true, progress: 100, stage: "", error: null }
        : { busy: true, progress: 0, stage: "Loading the language model…", error: null },
    );
    try {
      const vector = await encodeSearchText(text, (progress, stage) => {
        if (request === latest.current) setState((previous) => ({ ...previous, progress, stage }));
      });
      loaded.current = true;
      if (request !== latest.current) return null;
      setState({ busy: false, progress: 100, stage: "", error: null });
      return vector;
    } catch (error) {
      if (request === latest.current)
        setState({ busy: false, progress: 100, stage: "", error: failureMessage(error) });
      return null;
    }
  }, []);
  const cancel = useCallback(() => {
    latest.current += 1;
    setState({ busy: false, progress: 100, stage: "", error: null });
  }, []);
  return { ...state, encode, cancel };
};
