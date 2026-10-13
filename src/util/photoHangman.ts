import { shuffleGamePhotos, type PhotoGamePhoto } from "./photoGames";
import { PHOTO_SUBJECTS, photoSubjectClarity } from "./photoSubjects";
export { PHOTO_SUBJECTS as HANGMAN_SUBJECTS } from "./photoSubjects";

export const HANGMAN_MISSES = 6;
export const HANGMAN_INITIAL_CLUES = 2;
const HANGMAN_CLUES = HANGMAN_MISSES + HANGMAN_INITIAL_CLUES;
export type PhotoHangmanPuzzle = {
  answer: string;
  photos: PhotoGamePhoto[];
  subjects: string[];
  acceptedAnswers: string[];
};

export const buildPhotoHangman = (
  photos: PhotoGamePhoto[],
  random: () => number = Math.random,
  previousAnswer?: string,
): PhotoHangmanPuzzle | null => {
  const unique = [...new Map(photos.map((photo) => [photo.path, photo])).values()];
  if (unique.length < HANGMAN_CLUES) return null;
  const eligible = PHOTO_SUBJECTS.flatMap((subject) => {
    const clues = unique.flatMap((photo) => {
      const clarity = photoSubjectClarity(photo, subject.pattern);
      return clarity === null ? [] : [{ photo, clarity }];
    });
    return clues.length >= HANGMAN_CLUES ? [{ subject, clues }] : [];
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
    { length: HANGMAN_CLUES },
    (_, index) => ordered[Math.round((index * (ordered.length - 1)) / (HANGMAN_CLUES - 1))]!.photo,
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
