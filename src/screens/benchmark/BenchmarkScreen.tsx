import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import { Caption, Footer, Heading } from "../../components/ui";
import commonStyles from "../../styles/common.module.css";
import { encodePublicAssetPath } from "../../util/encodePublicAssetPath";
import benchmarkJson from "./captionBenchmark.json";
import { VendorIcon, type VendorKey } from "./VendorIcon";
import styles from "./BenchmarkScreen.module.css";

type Where = "local" | "cloud";

type ModelSummary = {
  key: string;
  name: string;
  note: string;
  where: Where;
  vendor: VendorKey;
  conceptPass: number;
  conceptTotal: number;
  conceptInTags: number;
  /** Only local models are measured for speed and memory. */
  perImageMs?: number;
  peakVramGb?: number;
  /** Only cloud models are billed. */
  costPer1kImagesUsd?: number;
  meanTags: number;
  junkRate: number;
  phraseRate: number;
};

type CaseResult = {
  passed: boolean;
  tags: string[];
  alt: string;
  trippedOn: string | null;
  conceptInTags: boolean;
  junkTags: string[];
};

type BenchmarkCase = {
  category: string;
  album: string;
  file: string;
  /** What the frame is, and why the ground truth is what it is. */
  comment: string;
  /** What the models did with it — read across the twelve, not per model. */
  analysis: string;
  requiredAny: string[];
  forbidden: string[];
  results: Record<string, CaseResult>;
};

// The generated JSON widens empty arrays to never[] and null fields to null,
// so the shape is declared here rather than inferred from the literal.
const data = benchmarkJson as unknown as {
  generatedAt: string;
  librarySize: number;
  models: ModelSummary[];
  cases: BenchmarkCase[];
};

// The five test-simple cases have no source images in a production build (test
// albums are excluded from normal builds), so their derivatives are generated
// once into a committed, non-gitignored location instead of the usual
// per-album resized-image cache.
const photoSrc = (album: string, file: string, size: 800 | 1600) =>
  album.startsWith("test-")
    ? encodePublicAssetPath(`/data/benchmark/${file}@${size}.avif`)
    : encodePublicAssetPath(`/data/albums/${album}/.resized_images/${file}@${size}.avif`);

const percent = (value: number) => `${Math.round(value * 100)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const money = (usd: number) => `$${usd.toFixed(2)}`;

const WhereBadge = ({ where }: { where: Where }) =>
  where === "cloud" ? <span className={styles.badge}>Cloud</span> : null;

const ModelLabel = ({ model, compact }: { model: ModelSummary; compact?: boolean }) => (
  <span className={styles.modelName}>
    <span className={styles.vendorIcon}>
      <VendorIcon vendor={model.vendor} />
    </span>
    <span className={styles.modelNameText}>
      {model.name}
      {model.key === "gemma-q4" ? (
        <span className={styles.star} title="Shipped default — see note below">
          {" ★"}
        </span>
      ) : null}
    </span>
    {compact ? null : <WhereBadge where={model.where} />}
  </span>
);

/** Inline bar. Width is data-derived, so it stays an inline style. */
const Bar = ({ fraction, muted }: { fraction: number; muted?: boolean }) => (
  <span className={styles.barTrack} aria-hidden="true">
    <span
      className={[styles.barFill, muted ? styles.barFillMuted : ""].filter(Boolean).join(" ")}
      style={{ inlineSize: `${Math.max(2, Math.round(fraction * 100))}%` }}
    />
  </span>
);

type Column = {
  label: string;
  hint: string;
  value: (model: ModelSummary) => string;
  fraction: (model: ModelSummary) => number;
  lowerIsBetter?: boolean;
};

const maxOf = (pick: (model: ModelSummary) => number) => Math.max(...data.models.map(pick));

const columns: Column[] = [
  {
    label: "Concept in tags",
    hint: "Cases where the required concept appears in the tags alone, not rescued by the sentence.",
    value: (m) => `${m.conceptInTags}/${m.conceptTotal}`,
    fraction: (m) => m.conceptInTags / m.conceptTotal,
  },
  {
    label: "Concrete phrases",
    hint: "Tags that are multi-word phrases, as the prompt asks, rather than bare words.",
    value: (m) => percent(m.phraseRate),
    fraction: (m) => m.phraseRate,
  },
  {
    label: "Junk tags",
    hint: "Tags that are stopwords lifted out of the model's own sentence.",
    value: (m) => percent(m.junkRate),
    fraction: (m) =>
      m.junkRate /
      Math.max(
        0.01,
        maxOf((x) => x.junkRate),
      ),
    lowerIsBetter: true,
  },
  {
    label: "Per image",
    hint: "Steady-state seconds per photo on the resident llama-server (the one-time model load is excluded — it amortises to nothing over a real batch). Only the local models were measured; the others ran through a different harness.",
    value: (m) => (m.perImageMs === undefined ? "—" : seconds(m.perImageMs)),
    fraction: (m) =>
      m.perImageMs === undefined ? 0 : m.perImageMs / maxOf((x) => x.perImageMs ?? 0),
    lowerIsBetter: true,
  },
  {
    label: "Peak VRAM",
    hint: "Peak GPU memory above idle, on a 10GB card. Cloud models run remotely and use none.",
    value: (m) => (m.peakVramGb === undefined ? "—" : `${m.peakVramGb}GB`),
    fraction: (m) => (m.peakVramGb === undefined ? 0 : m.peakVramGb / 10),
    lowerIsBetter: true,
  },
  {
    label: "Cost / 1k images",
    hint: "Estimated from published per-token pricing: ~1600 image tokens plus the prompt in, measured caption length out. Local models are free to run.",
    value: (m) => (m.costPer1kImagesUsd === undefined ? "—" : money(m.costPer1kImagesUsd)),
    fraction: (m) =>
      m.costPer1kImagesUsd === undefined
        ? 0
        : m.costPer1kImagesUsd / maxOf((x) => x.costPer1kImagesUsd ?? 0),
    lowerIsBetter: true,
  },
];

const ComparisonTable = () => {
  const janus = data.models.find((model) => model.key === "janus");

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption className={styles.tableCaption}>
          Bars are scaled within each column. Shaded bars are measures where less is better. ★ marks
          Gemma&nbsp;UD-Q4, the shipped default — chosen for its tags, not its raw score. The “tags
          only” column is why: Janus scores {janus?.conceptPass}/{janus?.conceptTotal} with tags and
          sentence merged but only {janus?.conceptInTags}/{janus?.conceptTotal} on tags alone — its
          sentence propping up bare-word tags. Tags are what the search index stores.
        </caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            {columns.map((column) => (
              <th key={column.label} scope="col">
                <abbr title={column.hint}>{column.label}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.models.map((model) => (
            <tr key={model.key}>
              <th scope="row" className={styles.modelCell}>
                <ModelLabel model={model} />
                <span className={styles.modelNote}>{model.note}</span>
              </th>
              {columns.map((column) => (
                <td key={column.label} data-label={column.label}>
                  <span className={styles.cellValue}>{column.value(model)}</span>
                  <Bar fraction={column.fraction(model)} muted={column.lowerIsBetter} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Visible companion to the header abbrs, which touch and keyboard users can't reach. */
const ColumnDefinitions = () => (
  <dl className={styles.columnDefinitions}>
    {columns.map((column) => (
      <div key={column.label} className={styles.columnDefinition}>
        <dt>{column.label}</dt>
        <dd>{column.hint}</dd>
      </div>
    ))}
  </dl>
);

const CaseRow = ({ entry }: { entry: BenchmarkCase }) => (
  <section className={styles.case}>
    <div className={styles.plate}>
      <img
        src={photoSrc(entry.album, entry.file, 800)}
        srcSet={`${photoSrc(entry.album, entry.file, 800)} 800w, ${photoSrc(entry.album, entry.file, 1600)} 1600w`}
        sizes="(max-width: 900px) 100vw, 260px"
        alt={entry.category}
        loading="lazy"
        className={styles.photo}
      />
      <Heading level={3}>{entry.category}</Heading>
      <div className={styles.truth}>
        <span className={styles.truthLabel}>Needs any</span>
        <span className={styles.chips}>
          {entry.requiredAny.map((term) => (
            <span key={term} className={[styles.chip, styles.chipRequired].join(" ")}>
              {term}
            </span>
          ))}
        </span>
        <span className={styles.truthLabel}>Must avoid</span>
        <span className={styles.chips}>
          {entry.forbidden.map((term) => (
            <span key={term} className={[styles.chip, styles.chipForbidden].join(" ")}>
              {term}
            </span>
          ))}
        </span>
      </div>
      {entry.comment ? <p className={styles.note}>{entry.comment}</p> : null}
    </div>

    <div className={styles.answers}>
      {entry.analysis ? (
        <p className={styles.analysis}>
          <span className={styles.analysisLabel}>What happened</span>
          {entry.analysis}
        </p>
      ) : null}
      <div className={styles.tableScroll}>
        <table className={[styles.table, styles.answerTable].join(" ")}>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Result</th>
              <th scope="col">Tags</th>
              <th scope="col">Alt text</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((model) => {
              const result = entry.results[model.key];
              if (!result) return null;
              return (
                <tr key={model.key} className={result.passed ? "" : styles.failRow}>
                  <th scope="row" className={styles.answerModel}>
                    <ModelLabel model={model} compact />
                  </th>
                  <td className={styles.answerVerdict} data-label="Result">
                    <span className={result.passed ? styles.passMark : styles.failMark}>
                      {result.passed ? "Pass" : "Fail"}
                    </span>
                    {result.trippedOn ? (
                      <span className={styles.why}>“{result.trippedOn}”</span>
                    ) : null}
                    {!result.conceptInTags && result.passed ? (
                      <span className={styles.why}>sentence only</span>
                    ) : null}
                  </td>
                  <td data-label="Tags">
                    <div className={styles.chips}>
                      {result.tags.map((tag) => (
                        <span
                          key={tag}
                          className={[
                            styles.chip,
                            result.junkTags.includes(tag) ? styles.chipJunk : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={styles.answerAlt} data-label="Alt text">
                    {result.alt}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </section>
);

const BenchmarkScreen = () => {
  const sonnet = data.models.find((model) => model.key === "sonnet-5");

  return (
    <>
      <Seo
        title="Caption benchmark | Snapshots"
        description="Twelve vision models captioning the same eleven photos, scored on tag quality, speed, memory and cost."
        pathname="/benchmark"
      />
      <GlobalNav />
      <main className={[commonStyles.stackPage, styles.page].join(" ")}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Caption backend · {data.generatedAt}</p>
          <Heading level={1}>Twelve models read the same eleven photos</Heading>
          <p className={styles.byline}>Written by Claude Opus 4.8</p>
          <p className={styles.lede}>
            Five run locally on a 10GB RTX 3080. The other seven are remote, marked{" "}
            <span className={styles.badge}>Cloud</span>, and went through a different harness, so
            their speed and memory are not measured and their rows say so. Tags are scored alone,
            not quietly propped up by the sentence next to them. That distinction turns out to be
            the entire story.
          </p>
          <p className={styles.lede}>
            Every frame here was looked at by a human before it was scored. The ground truth has
            been wrong twice anyway: once by the original author, who labelled a water monitor
            lizard a turtle, and once by the reviewer of this run, who was so pleased to catch the
            first error that he promptly committed a second.
            {sonnet?.costPer1kImagesUsd
              ? ` Cost, incidentally, is not the argument for staying local: all ${data.librarySize.toLocaleString("en-GB")} photos through Sonnet 5 come to about ${money((sonnet.costPer1kImagesUsd * data.librarySize) / 1000)}, which is less than the coffee consumed while measuring it.`
              : ""}
          </p>
        </header>

        <section className={styles.outcome}>
          <p className={styles.outcomeLabel}>What happened next</p>
          <p className={styles.outcomeBody}>
            Janus’s 3× speed lead was the old code reloading the model for every photo. On one
            resident server Gemma 4 E4B runs 1.6s a photo against Janus’s 1.3 — a fraction slower,
            not 3×, and with tags a search index can use. (The trick barely helped the larger Qwen,
            which is inference-bound, not load-bound.) So Gemma became the default and the library
            was re-captioned and shipped.
          </p>
          <p className={styles.outcomeBody}>
            The facet panel, previously “Japan” or “Singapore” and nothing else, now has a
            vocabulary — <em>sky, trees, building, night, mountain</em> — and 275 photos are
            findable by the text on their signs. The safety-check refused the first publish because
            the captions were made by the new model while it expected the old one; correct, if
            pedantic. A plan to hand-tune the ranking was measured, found to fix a problem the
            algorithm had already solved, and dropped.
          </p>
        </section>

        <section className={commonStyles.stack}>
          <Heading level={2}>How they compare</Heading>
          <ComparisonTable />
          <ColumnDefinitions />
        </section>

        <section className={commonStyles.stackXl}>
          <Heading level={2}>Every frame</Heading>
          {data.cases.map((entry) => (
            <CaseRow key={`${entry.album}/${entry.file}`} entry={entry} />
          ))}
        </section>

        <Caption>
          Eleven frames is not many. Treat a one-case gap as gossip rather than evidence. The
          durable finding is duller and more useful than the leaderboard: a benchmark that scores
          two fields together will cheerfully certify a model that has only got one of them right,
          and will go on doing so, quietly, for as long as nobody separates them.
        </Caption>
        <Footer />
      </main>
    </>
  );
};

export default BenchmarkScreen;
