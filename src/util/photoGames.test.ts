import {
  buildRelayPuzzle,
  rankDrawing,
  scoreRelay,
  chooseOracleQuestion,
  answerOracle,
} from "./photoGames";
import type { PhotoGamePhoto } from "./photoGames";

const photo = (path: string, vector: number[], caption = "A photograph"): PhotoGamePhoto => ({
  path,
  href: `/album/test#${path}`,
  caption,
  tags: "",
  vector,
});
const arc = Array.from({ length: 12 }, (_, i) =>
  photo(`${i}.jpg`, [Math.cos(i / 12), Math.sin(i / 12)]),
);

it("builds a relay with distinct endpoints and five unique playable photographs", () => {
  const puzzle = buildRelayPuzzle(arc, () => 0.3)!;
  expect(puzzle.tiles).toHaveLength(5);
  expect(new Set([puzzle.start, ...puzzle.tiles, puzzle.end].map((p) => p.path)).size).toBe(7);
  expect(scoreRelay(puzzle, puzzle.solution)).toBe(100);
  expect(scoreRelay(puzzle, puzzle.solution.slice(1))).toBeNull();
});

it("does not invent a relay when the archive is too small", () => {
  expect(buildRelayPuzzle(arc.slice(0, 6))).toBeNull();
});

it("ranks a sketch against compatible photo vectors and scores the target's archive rank", () => {
  const target = photo("target", [1, 0]);
  const other = photo("other", [0, 1]);
  expect(rankDrawing([1, 0], [other, target], target.path)).toMatchObject({
    nearest: target,
    rank: 1,
    score: 100,
  });
  expect(rankDrawing([0, 1], [other, target], target.path)).toMatchObject({
    nearest: other,
    rank: 2,
    score: 0,
  });
  expect(rankDrawing([1, 0, 0], [target], target.path)).toBeNull();
});

it("uses a balanced visual question and learns from answers without being given the secret photo", () => {
  const candidates = [
    photo("sea", [], "A boat on the sea"),
    photo("street", [], "A person on a city street"),
  ].map((p) => ({ photo: p, weight: 1 }));
  const question = chooseOracleQuestion(candidates, [])!;
  expect(question).toBeTruthy();
  const updated = answerOracle(
    candidates,
    question,
    question.matches(candidates[0]!.photo) ? "yes" : "no",
  );
  expect(updated[0]!.weight).toBeGreaterThan(updated[1]!.weight);
  expect(answerOracle(candidates, question, "unsure")).toEqual(candidates);
  expect(chooseOracleQuestion(candidates, [question.id])?.id).not.toBe(question.id);
});
