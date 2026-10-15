import { useEffect, useRef, useState } from "react";
import { Button, LoadingIndicator, Input, Icon } from "./ui";
import { useEmbeddingsDatabase } from "./database/useDatabase";
import { encodeSearchText } from "./search/textEmbeddings";
import { fetchSemanticPaths } from "./search/api";
import styles from "./CloudSpotlight.module.css";

export const CloudSpotlight = ({
  onMatches,
  tags = [],
}: {
  onMatches: (paths: string[] | null) => void;
  tags?: readonly string[];
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const randomTags = tags.filter((tag) => tag !== query && tag.trim());
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
        <div className={styles.inputContainer}>
          <Input
            ref={inputRef}
            aria-label="Find a scene"
            className={styles.query}
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Rainy streets, quiet rooms…"
          />
          <Button
            variant="quiet"
            size="icon"
            aria-label="Clear search"
            className={styles.clear}
            disabled={!input && !query}
            aria-hidden={!input && !query}
            onClick={() => {
              inputRef.current?.focus();
              setQuery("");
              setInput("");
              onMatches(null);
            }}
          >
            <Icon kind="close" />
          </Button>
        </div>
        <Button
          size="icon"
          aria-label="Random tag spotlight"
          title="Random tag spotlight"
          disabled={!randomTags.length}
          onClick={() => {
            const tag = randomTags[Math.floor(Math.random() * randomTags.length)];
            if (!tag) return;
            setInput(tag);
            onMatches(null);
            setQuery(tag);
          }}
        >
          <Icon kind="shuffle" />
        </Button>
        <Button type="submit" disabled={!input.trim() || input.trim() === query}>
          Spotlight
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
