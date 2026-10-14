/**
 * Scoring for the games that compare a player's words with a photograph:
 * Warmer and Caption It. Both rank the target among the whole archive by how
 * well it fits the text, because a raw similarity means different things for
 * different photographs — a busy street matches every word a little, an empty
 * sky matches almost none — and a rank does not.
 */
import { rankDrawing, type PhotoGamePhoto } from "./photoGames";

/** A target this close to the top counts as found: bursts of one scene tie for first. */
export const FOUND_RANK = 3;

export type TextScore = {
  rank: number;
  total: number;
  /** 0–100 resemblance, scaled between a typical photograph and the best match. */
  score: number | null;
  /** The photograph the text fits best. */
  nearest: PhotoGamePhoto;
  found: boolean;
};

export const scoreTextAgainstArchive = (
  vector: number[],
  photos: PhotoGamePhoto[],
  targetPath: string,
): TextScore | null => {
  const ranked = rankDrawing(vector, photos, targetPath);
  return ranked ? { ...ranked, found: ranked.rank <= FOUND_RANK } : null;
};

export type Temperature = {
  id: "found" | "burning" | "hot" | "warm" | "tepid" | "cool" | "freezing";
  label: string;
};

// Bands are shares of the archive, so "hot" means the same in any collection.
const BANDS: Array<[number, Temperature]> = [
  [0.01, { id: "burning", label: "Burning" }],
  [0.05, { id: "hot", label: "Hot" }],
  [0.15, { id: "warm", label: "Warm" }],
  [0.35, { id: "tepid", label: "Tepid" }],
  [0.6, { id: "cool", label: "Cool" }],
];

export const warmerTemperature = (rank: number, total: number): Temperature => {
  if (rank <= FOUND_RANK) return { id: "found", label: "Found it" };
  const share = (rank - 1) / Math.max(1, total - 1);
  return BANDS.find(([limit]) => share < limit)?.[1] ?? { id: "freezing", label: "Freezing" };
};

const MAX_BLUR_PX = 28;

/**
 * How blurred the hidden photograph still is, from the best guess so far.
 * Colours and shapes read from the start; detail arrives only near the top.
 */
export const warmerBlur = (bestRank: number | null, total: number): number => {
  if (bestRank === null) return MAX_BLUR_PX;
  if (bestRank <= 1) return 0;
  const share = Math.min(1, (bestRank - 1) / Math.max(1, total - 1) / 0.5);
  return Math.round(MAX_BLUR_PX * Math.sqrt(share) * 10) / 10;
};

export const normaliseGuess = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

/** Why a caption cannot be scored, or null when it can. */
export const captionProblem = (text: string): string | null => {
  const words = normaliseGuess(text).match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 2) return "Write at least two words.";
  const counts = new Map<string, number>();
  for (const word of words) {
    if (word.length > 2) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  // Repeating a word pushes the encoder towards it without describing more.
  if ([...counts.values()].some((count) => count > 2)) return "Use each word once or twice.";
  return null;
};
