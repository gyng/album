import type { SearchResultRow } from "./searchTypes";

type Scores = Pick<SearchResultRow, "rrfScore" | "similarity" | "colorMatchScore">;
type Score = { kind: "hybrid" | "similarity" | "colour"; value: number };

const scoreOf = (result: Scores): Score | null => {
  if (typeof result.rrfScore === "number" && Number.isFinite(result.rrfScore))
    return { kind: "hybrid", value: result.rrfScore };
  if (typeof result.colorMatchScore === "number" && Number.isFinite(result.colorMatchScore))
    return { kind: "colour", value: result.colorMatchScore / 100 };
  if (typeof result.similarity === "number" && Number.isFinite(result.similarity))
    return { kind: "similarity", value: result.similarity };
  return null;
};

/** Compare scores within one query; fused ranks are not cosine percentages. */
export const resultTextOpacities = (results: readonly Scores[]): number[] => {
  const scores = results.map(scoreOf);
  const best = { hybrid: -Infinity, similarity: -Infinity, colour: -Infinity };
  for (const score of scores) {
    if (score) best[score.kind] = Math.max(best[score.kind], score.value);
  }
  return scores.map((score) => {
    if (!score) return 1;
    const strongest = best[score.kind];
    const gap =
      score.kind === "hybrid"
        ? strongest > 0
          ? (strongest - score.value) / strongest
          : 0
        : strongest - score.value;
    // Keep near ties clear, and retain readable text even in the weakest tail.
    return Math.max(0.72, 1 - Math.max(0, gap - 0.05) * 1.4);
  });
};
