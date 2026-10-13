import {
  addHangmanSubjectGuess,
  buildPhotoHangman,
  hangmanSubjectStatus,
  wrongHangmanSubjects,
  HANGMAN_MISSES,
  HANGMAN_SUBJECTS,
} from "./photoHangman";
import type { PhotoGamePhoto } from "./photoGames";
const photo = (id: string, caption: string, tags = ""): PhotoGamePhoto => ({
  path: `../albums/test-simple/${id}.jpg`,
  href: `/album/test-simple#${id}.jpg`,
  caption,
  tags,
  vector: [],
});
const cats = [
  "A close-up of a cat looking towards the camera.",
  "A cat sits on a bench.",
  "A cat stands beside a bicycle.",
  "A street with a cat in the background.",
  "Buildings and signs, with a cat barely visible in the distance.",
  "A tree beside the water.",
  "A person standing near a cat.",
].map((caption, index) => photo(`cat-${index}`, caption, index === 5 ? "cat, tree" : ""));
const boats = Array.from({ length: 7 }, (_, index) => photo(`boat-${index}`, "A boat on a lake."));
const archive = ["cat", "dog", "train", "bridge", "window", "chair", "bicycle", "boat"].flatMap(
  (subject) =>
    Array.from({ length: 7 }, (_, index) => photo(`${subject}-${index}`, `A ${subject}.`)),
);

it("builds seven unique matching clues with indirect mentions before prominent ones", () => {
  const puzzle = buildPhotoHangman([...cats, ...boats], () => 0.3, "BOAT")!;
  expect(puzzle.answer).toBe("CAT");
  expect(puzzle.photos).toHaveLength(HANGMAN_MISSES + 1);
  expect(new Set(puzzle.photos.map((p) => p.path)).size).toBe(7);
  const subject = HANGMAN_SUBJECTS.find((subject) => subject.answer === puzzle.answer)!;
  expect(puzzle.photos.every((p) => subject.pattern.test(`${p.caption} ${p.tags}`))).toBe(true);
  expect(puzzle.photos[0]!.tags).toContain("cat");
  expect(puzzle.photos.at(-1)!.caption).toMatch(/^A close-up of a cat/);
  expect(puzzle.photos.findIndex((p) => p.caption.includes("in the background"))).toBeLessThan(
    puzzle.photos.findIndex((p) => p.caption.startsWith("A cat sits")),
  );
  expect(puzzle.subjects).toEqual(["BOAT", "CAT"]);
  expect(puzzle.acceptedAnswers).toEqual(["CAT"]);
});

it("uses word boundaries and rejects negated subjects, undersized pools and duplicate paths", () => {
  expect(buildPhotoHangman(cats.slice(0, 6))).toBeNull();
  expect(buildPhotoHangman([...cats.slice(0, 6), cats[0]!])).toBeNull();
  expect(
    buildPhotoHangman([
      ...cats.slice(0, 6),
      photo("not-cat", "A cathedral, without a cat in sight.", "cat"),
      ...boats,
    ]),
  ).toBeNull();
  expect(
    buildPhotoHangman([...cats.slice(0, 6), photo("cathedral", "A cathedral"), ...boats]),
  ).toBeNull();
});

it("declines a one-choice archive and does not confuse modifiers or food names with subjects", () => {
  expect(buildPhotoHangman(cats)).toBeNull();
  const stations = Array.from({ length: 7 }, (_, index) =>
    photo(`station-${index}`, "A train station at night.", "train_station"),
  );
  expect(buildPhotoHangman([...stations, ...boats])).toBeNull();
  const meals = Array.from({ length: 7 }, (_, index) =>
    photo(`meal-${index}`, "A hot dog on a plate.", "hot_dog"),
  );
  expect(buildPhotoHangman([...meals, ...boats])).toBeNull();
});

it("avoids repeating the previous subject", () => {
  expect(buildPhotoHangman([...cats, ...boats], () => 0, "cat")!.answer).toBe("BOAT");
  expect(buildPhotoHangman([...cats, ...boats], () => 0, "boat")!.answer).toBe("CAT");
});

it("accepts every eligible subject shared by all seven clues", () => {
  const catChairs = Array.from({ length: 7 }, (_, index) =>
    photo(`cat-chair-${index}`, "A cat on a chair."),
  );
  const puzzle = buildPhotoHangman([...catChairs, ...boats], () => 0.3, "BOAT")!;
  expect(new Set(puzzle.acceptedAnswers)).toEqual(new Set(["CAT", "CHAIR"]));
  expect(hangmanSubjectStatus(puzzle, ["chair"])).toBe("won");
  expect(wrongHangmanSubjects(puzzle, ["cat", "chair", "boat"])).toEqual(["BOAT"]);
});

it("wins on a truthful subject and loses only after six unique valid wrong subjects", () => {
  const puzzle = buildPhotoHangman(archive, () => 0.3)!;
  const wrong = puzzle.subjects.filter((subject) => !puzzle.acceptedAnswers.includes(subject));
  expect(hangmanSubjectStatus(puzzle, [puzzle.answer.toLowerCase()])).toBe("won");
  expect(hangmanSubjectStatus(puzzle, wrong.slice(0, 5))).toBe("playing");
  expect(hangmanSubjectStatus(puzzle, wrong.slice(0, 6))).toBe("lost");
  expect(
    hangmanSubjectStatus(puzzle, [...wrong.slice(0, 5), wrong[0]!.toLowerCase(), "not a subject"]),
  ).toBe("playing");
  expect(
    wrongHangmanSubjects(puzzle, [
      wrong[0]!.toLowerCase(),
      wrong[0]!,
      puzzle.answer,
      "not a subject",
    ]),
  ).toEqual([wrong[0]]);
});

it("normalises bank choices, ignores duplicates and unknown input, and preserves terminal rounds", () => {
  const puzzle = buildPhotoHangman(archive, () => 0.3)!;
  const wrong = puzzle.subjects.filter((subject) => !puzzle.acceptedAnswers.includes(subject));
  expect(addHangmanSubjectGuess(puzzle, [], wrong[0]!.toLowerCase())).toEqual([wrong[0]]);
  expect(addHangmanSubjectGuess(puzzle, [wrong[0]!], wrong[0]!.toLowerCase())).toEqual([wrong[0]]);
  expect(addHangmanSubjectGuess(puzzle, [], "Enter")).toEqual([]);
  expect(addHangmanSubjectGuess(puzzle, [], "imaginary subject")).toEqual([]);
  expect(addHangmanSubjectGuess(puzzle, [puzzle.answer], wrong[0]!)).toEqual([puzzle.answer]);
  const lost = wrong.slice(0, 6);
  expect(addHangmanSubjectGuess(puzzle, lost, puzzle.answer)).toEqual(lost);
});
