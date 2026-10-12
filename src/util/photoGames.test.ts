import {
  buildRelayPuzzle,
  rankDrawing,
  scoreRelay,
  chooseOracleQuestion,
  answerOracle,
  buildOracleCohort,
  ORACLE_QUESTIONS,
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

it("uses a compatible group of vectors and avoids near-duplicate relay frames when alternatives exist", () => {
  const varied = Array.from({ length: 24 }, (_, i) =>
    photo(`v${i}`, [Math.cos(i * 0.13), Math.sin(i * 0.13)]),
  );
  const puzzle = buildRelayPuzzle(
    [
      ...varied,
      ...varied.map((p) => ({ ...p, path: `copy-${p.path}` })),
      photo("wrong-space", [1, 0, 0]),
    ],
    () => 0.4,
  )!;
  expect(puzzle).toBeTruthy();
  const frames = [puzzle.start, ...puzzle.tiles, puzzle.end];
  expect(frames.every((p) => p.vector.length === 2)).toBe(true);
  expect(new Set(frames.map((p) => p.path.replace("copy-", ""))).size).toBe(7);
});

it("does not penalise tied sketch matches or accept non-finite drawing vectors", () => {
  const target = photo("z", [1, 0]);
  expect(
    rankDrawing([1, 0], [photo("a", [1, 0]), photo("other", [0, 1]), target], target.path),
  ).toMatchObject({
    rank: 1,
    score: 100,
  });
  expect(rankDrawing([NaN, 0], [target], target.path)).toBeNull();
});

it("does not give a weak drawing match a high score merely because the archive contains many worse matches", () => {
  const vector = (similarity: number) => [similarity, Math.sqrt(1 - similarity ** 2)];
  const target = photo("target", vector(0.45));
  const photos = [
    photo("closest", vector(0.95)),
    target,
    ...Array.from({ length: 1000 }, (_, i) => photo(`other-${i}`, vector(0.1))),
  ];
  const result = rankDrawing([1, 0], photos, target.path)!;
  expect(result.rank).toBe(2);
  expect(result.score).toBeLessThan(50);
  expect(rankDrawing([1, 0], photos, "closest")?.score).toBe(100);
});

it("keeps oracle questions grounded in visible descriptions rather than incidental venue names or lighting", () => {
  const indoors = ORACLE_QUESTIONS.find((q) => q.id === "indoors")!;
  const night = ORACLE_QUESTIONS.find((q) => q.id === "night")!;
  const people = ORACLE_QUESTIONS.find((q) => q.id === "people")!;
  expect(indoors.matches(photo("a", [], "The exterior of a restaurant on a street."))).toBe(false);
  expect(indoors.matches(photo("b", [], "An interior with tables inside a restaurant."))).toBe(
    true,
  );
  expect(night.matches(photo("c", [], "A building illuminated by bright sunlight."))).toBe(false);
  expect(
    people.matches({
      ...photo("d", [], "A street with no visible people."),
      tags: "people, street",
    }),
  ).toBe(false);
  expect(people.matches(photo("e", [], "No cars, but a person walks on the pavement."))).toBe(true);
});

it("selects an oracle cohort with distinguishable visual question signatures", () => {
  const coast = photo("coast", [], "A boat on the sea");
  const city = photo("city", [], "A person on a city street");
  const inside = photo("inside", [], "A cat in a room");
  const cohort = buildOracleCohort(
    [coast, { ...coast, path: "coast-copy" }, city, inside],
    12,
    () => 0.5,
  );
  expect(cohort).toHaveLength(3);
  expect(new Set(cohort.map((p) => ORACLE_QUESTIONS.map((q) => q.matches(p)).join())).size).toBe(3);
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

it("withholds a drawing score when the archive cannot distinguish matches", () => {
  expect(rankDrawing([1, 0], [photo("a", [0, 1]), photo("b", [0, 1])], "a")?.score).toBeNull();
});
it("grades relay orders against all possible routes with a neutral random-order baseline", () => {
  const puzzle = buildRelayPuzzle(arc, () => 0.3)!;
  const permutations = (items: PhotoGamePhoto[]): PhotoGamePhoto[][] =>
    items.length
      ? items.flatMap((item, i) =>
          permutations(items.filter((_, j) => i !== j)).map((tail) => [item, ...tail]),
        )
      : [[]];
  const scores = permutations(puzzle.tiles).map((order) => scoreRelay(puzzle, order)!);
  expect(Math.min(...scores)).toBe(0);
  expect(Math.max(...scores)).toBe(100);
  expect(scores.reduce((sum, score) => sum + score, 0) / scores.length).toBeCloseTo(50, 0);
});

it("withholds relay scores when every route is equally similar", () => {
  const puzzle = buildRelayPuzzle(
    Array.from({ length: 7 }, (_, i) => photo(String(i), [1, 0])),
    () => 0.4,
  )!;
  expect(scoreRelay(puzzle, puzzle.solution)).toBeNull();
});
