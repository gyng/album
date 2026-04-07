import { NextPage } from "next/types";
import { useRouter } from "next/router";
import { useDatabase } from "../../components/database/useDatabase";
import { ProgressBar } from "../../components/ProgressBar";
import { GlobalNav } from "../../components/GlobalNav";
import { GuessGame } from "../../components/guess/GuessGame";
import { Seo } from "../../components/Seo";
import styles from "./guess.module.css";

type PageProps = {};

const DEFAULT_ROUNDS = 5;

const parseDifficulty = (
  value: string | string[] | undefined,
): "easy" | "medium" | "hard" => {
  if (value === "easy" || value === "hard") return value;
  return "medium";
};

const GuessPage: NextPage<PageProps> = () => {
  const router = useRouter();
  const [database, progress] = useDatabase();

  const rounds = Math.min(
    20,
    Math.max(1, Number(router.query.rounds) || DEFAULT_ROUNDS),
  );
  const filter =
    typeof router.query.filter === "string" ? router.query.filter : undefined;
  const difficulty = parseDifficulty(router.query.difficulty);

  return (
    <>
      <Seo
        title="Guess Where | Snapshots"
        description="A GeoGuessr-style game using your own photos."
        pathname="/guess"
        noindex
      />
      <main className={styles.page}>
        <GlobalNav currentPage="guess" />

        {!database ? (
          <div className={styles.loading}>
            <h1 className={styles.title}>Guess Where</h1>
            <p>Loading photo database&hellip;</p>
            <ProgressBar progress={progress} />
          </div>
        ) : (
          <GuessGame
            database={database}
            rounds={rounds}
            filter={filter}
            difficulty={difficulty}
          />
        )}
      </main>
    </>
  );
};

export default GuessPage;
