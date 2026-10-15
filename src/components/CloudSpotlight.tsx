import { useEffect, useState, useId } from "react";
import { Button, LoadingIndicator, Input } from "./ui";
import { useEmbeddingsDatabase } from "./database/useDatabase";
import { encodeSearchText } from "./search/textEmbeddings";
import { fetchSemanticPaths } from "./search/api";
import styles from "./CloudSpotlight.module.css";

export const CloudSpotlight = ({ onMatches }: { onMatches: (paths: string[] | null) => void }) => {
  const queryId = useId();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  return (
    <div className={styles.search}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && input.trim() !== query) {
            onMatches(null);
            setQuery(input.trim());
          }
        }}
      >
        <label htmlFor={queryId}>Find a scene</label>
        <Input
          id={queryId}
          className={styles.query}
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Rainy streets, quiet rooms…"
        />
        <Button type="submit" disabled={!input.trim() || input.trim() === query}>
          Spotlight
        </Button>
        <Button
          variant="quiet"
          className={styles.clear}
          disabled={!query}
          aria-hidden={!query}
          onClick={() => {
            setQuery("");
            setInput("");
            onMatches(null);
          }}
        >
          Clear search
        </Button>
      </form>
      <div className={styles.feedback}>
        {query ? <RankScene key={query} query={query} onMatches={onMatches} /> : null}
      </div>
    </div>
  );
};

const RankScene = ({
  query,
  onMatches,
}: {
  query: string;
  onMatches: (paths: string[] | null) => void;
}) => {
  const [embeddings, , , embeddingsError] = useEmbeddingsDatabase();
  const [stage, setStage] = useState("Loading image search…");
  // Which request the outcome belongs to: a new database or callback starts a
  // new search, which reads as busy again until it settles.
  const [outcome, setOutcome] = useState<{
    embeddings: typeof embeddings;
    onMatches: typeof onMatches;
    failed: boolean;
  } | null>(null);
  const settled = outcome?.embeddings === embeddings && outcome.onMatches === onMatches;
  const busy = !settled;
  const error = settled && outcome.failed;
  useEffect(() => {
    if (!embeddings) return;
    let cancelled = false;
    encodeSearchText(query, (_progress, nextStage) => {
      if (!cancelled && nextStage)
        setStage(
          /encod|compar|rank/i.test(nextStage) ? "Finding photographs…" : "Preparing scene search…",
        );
    })
      .then((vector) => (cancelled ? null : fetchSemanticPaths(embeddings, vector)))
      .then((result) => {
        if (!cancelled && result) {
          onMatches(result);
          setOutcome({ embeddings, onMatches, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) setOutcome({ embeddings, onMatches, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [query, embeddings, onMatches]);
  if (error || embeddingsError)
    return <p role="alert">Scene search could not load. Clear it and try again.</p>;
  return busy ? (
    <div role="status" aria-busy="true">
      <LoadingIndicator label={stage} />
    </div>
  ) : null;
};
