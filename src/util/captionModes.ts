/**
 * The harder ways to play Caption It: a word budget, banned words, captioning a
 * photograph apart from its lookalikes, and one caption for a set of three.
 */
import { shuffleGamePhotos, type PhotoGamePhoto } from "./photoGames";
import { scoreTextAgainstArchive, type TextScore } from "./semanticGames";

export type CaptionMode = "single" | "lookalikes" | "set";
export type CaptionBudget = null | 12 | 8 | 5;

/** Words as a reader counts them: "tram-stop" and "o'clock" are one each. */
export const captionWords = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

export const captionBudgetProblem = (text: string, budget: CaptionBudget): string | null =>
  budget !== null && captionWords(text).length > budget ? `Use ${budget} words at most.` : null;

// One form for singular and plural, so banning "bridge" also bans "bridges".
const stem = (word: string) =>
  word.endsWith("ies") && word.length > 4
    ? `${word.slice(0, -3)}y`
    : word.endsWith("es") && /(?:s|x|z|ch|sh)es$/.test(word)
      ? word.slice(0, -2)
      : word.endsWith("s") && !word.endsWith("ss") && word.length > 3
        ? word.slice(0, -1)
        : word;

const IGNORED = new Set(["the", "and", "with", "photo", "photograph", "image", "view"]);

const tagWords = (photo: PhotoGamePhoto): string[] => [
  ...new Set(
    photo.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => /^[a-z][a-z _-]{2,29}$/.test(tag))
      .flatMap((tag) => tag.split(/[ _-]+/))
      .filter((word) => word.length >= 3 && !IGNORED.has(word))
      .map(stem),
  ),
];

/**
 * The words that would make the caption easy: the rarest words in the
 * photographs' tags, since a word few photographs carry is the one that picks
 * these out. For a set, words that two or more of it share come first — the
 * obvious thread that ties them together.
 */
export const bannedWordsFor = (
  dealt: readonly PhotoGamePhoto[],
  archive: readonly PhotoGamePhoto[],
  count = 3,
): string[] => {
  const frequency = new Map<string, number>();
  for (const photo of archive)
    for (const word of tagWords(photo)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const shared = new Map<string, number>();
  for (const photo of dealt)
    for (const word of tagWords(photo)) shared.set(word, (shared.get(word) ?? 0) + 1);
  return [...shared]
    .sort(
      ([a, inA], [b, inB]) =>
        Number(dealt.length > 1 && inB > 1) - Number(dealt.length > 1 && inA > 1) ||
        (frequency.get(a) ?? 0) - (frequency.get(b) ?? 0) ||
        a.localeCompare(b),
    )
    .slice(0, count)
    .map(([word]) => word);
};

export const bannedWordProblem = (text: string, banned: readonly string[]): string | null => {
  const used = captionWords(text)
    .flatMap((word) => word.split(/['’-]/))
    .find((word) => banned.includes(stem(word)));
  return used ? `“${used}” is one of the banned words.` : null;
};

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  if (a.length !== b.length || !a.length) return Number.NaN;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(na * nb);
};

// Measured on the archive's SigLIP v1 vectors: a photograph's nearest
// neighbour is typically 0.81 alike, and frames of one burst above about 0.93.
// Lookalikes come from between, close enough to confuse a loose caption but
// never so close that no caption could tell them apart.
const LOOKALIKE_MIN = 0.75;
const LOOKALIKE_MAX = 0.93;
export const LOOKALIKE_COUNT = 3;
const ATTEMPTS = 60;

export type LookalikeDeal = { photo: PhotoGamePhoto; lookalikes: PhotoGamePhoto[] };

export const dealLookalikes = (
  eligible: readonly PhotoGamePhoto[],
  archive: readonly PhotoGamePhoto[],
  random: () => number = Math.random,
  exclude?: string,
): LookalikeDeal | null => {
  for (const photo of shuffleGamePhotos(eligible, random).slice(0, ATTEMPTS)) {
    if (photo.path === exclude) continue;
    const near = archive
      .filter((other) => other.path !== photo.path)
      .map((other) => ({ other, similarity: cosine(photo.vector, other.vector) }))
      .filter(({ similarity }) => similarity >= LOOKALIKE_MIN && similarity <= LOOKALIKE_MAX)
      .sort((a, b) => b.similarity - a.similarity);
    const lookalikes: PhotoGamePhoto[] = [];
    // Lookalikes of each other would be one lookalike shown twice.
    for (const { other } of near) {
      if (lookalikes.every((chosen) => cosine(chosen.vector, other.vector) <= LOOKALIKE_MAX))
        lookalikes.push(other);
      if (lookalikes.length === LOOKALIKE_COUNT) return { photo, lookalikes };
    }
  }
  return null;
};

/** How many lookalikes the caption fits less well than the photograph itself. */
export const separation = (
  vector: number[],
  deal: LookalikeDeal,
): { ahead: number; behind: string[] } => {
  const own = cosine(vector, deal.photo.vector);
  const behind = deal.lookalikes
    .filter((lookalike) => cosine(vector, lookalike.vector) >= own)
    .map((lookalike) => lookalike.path);
  return { ahead: deal.lookalikes.length - behind.length, behind };
};

export const SET_SIZE = 3;
/** The share of the archive a set's photograph must rank within to count as found. */
export const SET_NEAR_TOP = 0.05;
const SET_MAX_ALIKE = 0.85;

/** Three photographs from one album, different enough that one word cannot cover them. */
export const dealCaptionSet = (
  eligible: readonly PhotoGamePhoto[],
  random: () => number = Math.random,
): PhotoGamePhoto[] | null => {
  const albums = new Map<string, PhotoGamePhoto[]>();
  for (const photo of eligible) {
    const album = photo.path.slice(0, photo.path.lastIndexOf("/") + 1);
    albums.set(album, [...(albums.get(album) ?? []), photo]);
  }
  for (const album of shuffleGamePhotos(
    [...albums.values()].filter((members) => members.length >= SET_SIZE),
    random,
  ).slice(0, ATTEMPTS)) {
    const set: PhotoGamePhoto[] = [];
    for (const photo of shuffleGamePhotos(album, random)) {
      if (set.every((chosen) => cosine(chosen.vector, photo.vector) <= SET_MAX_ALIKE))
        set.push(photo);
      if (set.length === SET_SIZE) return set;
    }
  }
  return null;
};

export type SetScore = { scores: TextScore[]; fit: number | null; found: number; won: boolean };

export const scoreCaptionSet = (
  vector: number[],
  set: readonly PhotoGamePhoto[],
  archive: PhotoGamePhoto[],
): SetScore | null => {
  const scores = set.map((photo) => scoreTextAgainstArchive(vector, archive, photo.path));
  if (scores.some((score) => !score)) return null;
  const valid = scores as TextScore[];
  const fits = valid.flatMap((score) => (score.score === null ? [] : [score.score]));
  const found = valid.filter(
    (score) => (score.rank - 1) / Math.max(1, score.total - 1) < SET_NEAR_TOP,
  ).length;
  return {
    scores: valid,
    fit: fits.length ? Math.round(fits.reduce((sum, fit) => sum + fit, 0) / fits.length) : null,
    found,
    won: found === set.length,
  };
};
