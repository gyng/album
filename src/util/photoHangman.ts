import { shuffleGamePhotos, type PhotoGamePhoto } from "./photoGames";

export const HANGMAN_MISSES = 6;
export type PhotoHangmanPuzzle = {
  answer: string;
  photos: PhotoGamePhoto[];
  subjects: string[];
  acceptedAnswers: string[];
};

// Concrete visible subjects, rather than moods or the indexing model's abstract tags.
export const HANGMAN_SUBJECTS: ReadonlyArray<{ answer: string; pattern: RegExp }> = [
  ["BIRD", "birds?"],
  ["BRIDGE", "bridges?"],
  ["BICYCLE", "bicycles?"],
  ["BOAT", "boats?"],
  ["CAT", "cats?"],
  ["DOG", "dogs?"],
  ["DEER", "deer"],
  ["DOOR", "doors?"],
  ["WINDOW", "windows?"],
  ["FLOWER", "flowers?"],
  ["TREE", "trees?"],
  ["MOUNTAIN", "mountains?"],
  ["STATUE", "statues?"],
  ["LANTERN", "lanterns?"],
  ["UMBRELLA", "umbrellas?"],
  ["TRAIN", "trains?"],
  ["BENCH", "bench(?:es)?"],
  ["CASTLE", "castles?"],
  ["TEMPLE", "temples?"],
  ["TOWER", "towers?"],
  ["BUS", "bus(?:es)?"],
  ["CAR", "cars?"],
  ["SIGN", "signs?"],
  ["CLOCK", "clocks?"],
  ["STAIRS", "stairs|staircase(?:s)?"],
  ["FENCE", "fences?"],
  ["CHAIR", "chairs?"],
  ["TABLE", "tables?"],
  ["BALLOON", "balloons?"],
  ["BOTTLE", "bottles?"],
  ["LAMP", "lamps?"],
  ["BAG", "bags?"],
  ["BOOK", "books?"],
  ["HOUSE", "houses?"],
  ["CHURCH", "church(?:es)?"],
  ["WATERFALL", "waterfalls?"],
  ["WINDMILL", "windmills?"],
  ["LIGHTHOUSE", "lighthouses?"],
].map(([answer, words]) => ({ answer: answer!, pattern: new RegExp(`\\b(?:${words})\\b`, "i") }));

const captionMentions = (caption: string, pattern: RegExp): number[] =>
  [...caption.matchAll(new RegExp(pattern.source, "gi"))].flatMap((mention) => {
    const prefix = caption.slice(Math.max(0, mention.index! - 60), mention.index);
    const suffix = caption.slice(mention.index! + mention[0].length);
    if (/^trains?$/i.test(mention[0]) && /^\s+(?:stations?|tracks?|platforms?)\b/i.test(suffix))
      return [];
    if (/^dogs?$/i.test(mention[0]) && /\bhot\s+$/i.test(prefix)) return [];
    return /\b(?:no|without|not|absence of)\s+(?:[\w-]+\s+){0,2}$/i.test(prefix)
      ? []
      : [mention.index!];
  });

const clueClarity = (photo: PhotoGamePhoto, pattern: RegExp): number | null => {
  const mentions = captionMentions(photo.caption, pattern);
  if (!mentions.length) {
    // An explicit negation outranks a generic tag left by the indexer.
    if (pattern.test(photo.caption)) return null;
    const tagPattern = new RegExp(`^(?:${pattern.source})$`, "i");
    return photo.tags.split(",").some((tag) => tagPattern.test(tag.trim())) ? 0 : null;
  }
  return Math.max(
    ...mentions.map((index) => {
      const context = photo.caption.slice(Math.max(0, index - 50), index + 90);
      if (
        /\b(?:background|distance|distant|barely visible|tiny|small|partially obscured)\b/i.test(
          context,
        )
      )
        return 1;
      if (/\b(?:close-up|close up|portrait|fills? the frame)\b/i.test(context)) return 5;
      return index < 40 ? 4 : 2;
    }),
  );
};

export const buildPhotoHangman = (
  photos: PhotoGamePhoto[],
  random: () => number = Math.random,
  previousAnswer?: string,
): PhotoHangmanPuzzle | null => {
  const unique = [...new Map(photos.map((photo) => [photo.path, photo])).values()];
  if (unique.length < HANGMAN_MISSES + 1) return null;
  const eligible = HANGMAN_SUBJECTS.flatMap((subject) => {
    const clues = unique.flatMap((photo) => {
      const clarity = clueClarity(photo, subject.pattern);
      return clarity === null ? [] : [{ photo, clarity }];
    });
    return clues.length >= HANGMAN_MISSES + 1 ? [{ subject, clues }] : [];
  });
  if (eligible.length < 2) return null;
  const alternatives = eligible.filter(
    (item) => item.subject.answer !== previousAnswer?.toUpperCase(),
  );
  const chosen = shuffleGamePhotos(alternatives.length ? alternatives : eligible, random)[0];
  if (!chosen) return null;
  const ordered = shuffleGamePhotos(chosen.clues, random).sort((a, b) => a.clarity - b.clarity);
  // Spread the clues across the available range so the final reveal is one of the clearest.
  const selection = Array.from(
    { length: HANGMAN_MISSES + 1 },
    (_, index) => ordered[Math.round((index * (ordered.length - 1)) / HANGMAN_MISSES)]!.photo,
  );
  const selectedPaths = new Set(selection.map((photo) => photo.path));
  return {
    answer: chosen.subject.answer,
    photos: selection,
    subjects: eligible.map((item) => item.subject.answer).sort(),
    acceptedAnswers: eligible
      .filter(
        (item) =>
          item.clues.filter((clue) => selectedPaths.has(clue.photo.path)).length ===
          selection.length,
      )
      .map((item) => item.subject.answer),
  };
};

const guessedSubjects = (puzzle: PhotoHangmanPuzzle, guesses: string[]): string[] => [
  ...new Set(
    guesses
      .map((guess) => guess.trim().toUpperCase())
      .filter((guess) => puzzle.subjects.includes(guess)),
  ),
];

export const wrongHangmanSubjects = (puzzle: PhotoHangmanPuzzle, guesses: string[]): string[] =>
  guessedSubjects(puzzle, guesses).filter((guess) => !puzzle.acceptedAnswers.includes(guess));

export const hangmanSubjectStatus = (
  puzzle: PhotoHangmanPuzzle,
  guesses: string[],
): "playing" | "won" | "lost" => {
  if (guessedSubjects(puzzle, guesses).some((guess) => puzzle.acceptedAnswers.includes(guess)))
    return "won";
  return wrongHangmanSubjects(puzzle, guesses).length >= HANGMAN_MISSES ? "lost" : "playing";
};

export const addHangmanSubjectGuess = (
  puzzle: PhotoHangmanPuzzle,
  guesses: string[],
  subject: string,
): string[] => {
  const answer = subject.trim().toUpperCase();
  if (
    !puzzle.subjects.includes(answer) ||
    guessedSubjects(puzzle, guesses).includes(answer) ||
    hangmanSubjectStatus(puzzle, guesses) !== "playing"
  )
    return guesses;
  return [...guesses, answer];
};
