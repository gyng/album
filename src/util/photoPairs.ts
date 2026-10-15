import { shuffleGamePhotos, type PhotoGamePhoto } from "./photoGames";
import { PHOTO_SUBJECTS, photoSubjectClarity } from "./photoSubjects";

export type PairMode = "visual" | "semantic";
export type PairCard = { photo: PhotoGamePhoto; pair: number; subject?: string };
export type PairsState = { open: number[]; matched: number[]; turns: number };
export const initialPairsState = (): PairsState => ({ open: [], matched: [], turns: 0 });

export const flipPairCard = (
  state: PairsState,
  index: number,
  cards: PairCard[],
  matchSize: 2 | 3 | 4 = 2,
): PairsState => {
  if (
    !cards[index] ||
    state.open.length === matchSize ||
    state.open.includes(index) ||
    state.matched.includes(index)
  )
    return state;
  const open = [...state.open, index];
  if (open.length < matchSize) return { ...state, open };
  return open.every((position) => cards[position]!.pair === cards[index]!.pair)
    ? { open: [], matched: [...state.matched, ...open], turns: state.turns + 1 }
    : { ...state, open, turns: state.turns + 1 };
};

const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);

/** Distinct photos per group; semantic boards use a different visible subject for each group. */
export const buildPhotoPairs = (
  photos: PhotoGamePhoto[],
  count: number,
  mode: PairMode,
  random = Math.random,
  matchSize: 2 | 3 | 4 = 2,
): PairCard[] | null => {
  if (!Number.isInteger(count) || count < 2 || count > 24 || ![2, 3, 4].includes(matchSize))
    return null;
  const unique = [...new Map(photos.map((photo) => [photo.path, photo])).values()];
  const pairs: PairCard[] = [];
  const used = new Set<string>();
  if (mode === "semantic") {
    const topics = shuffleGamePhotos(PHOTO_SUBJECTS, random).map((topic) => ({
      ...topic,
      photos: shuffleGamePhotos(
        unique.filter((photo) => photoSubjectClarity(photo, topic.pattern) !== null),
        random,
      ),
    }));
    const chosen: RegExp[] = [];
    for (const topic of topics) {
      const candidates = topic.photos.filter(
        (photo) =>
          !used.has(photo.path) &&
          chosen.every((pattern) => photoSubjectClarity(photo, pattern) === null),
      );
      // Earlier pairs must not also belong to the next subject, or a cross-pair guess could be valid.
      if (
        candidates.length < matchSize ||
        pairs.some((card) => photoSubjectClarity(card.photo, topic.pattern) !== null)
      )
        continue;
      const pair = pairs.length / matchSize;
      for (const photo of candidates.slice(0, matchSize)) {
        used.add(photo.path);
        pairs.push({ photo, pair, subject: topic.answer });
      }
      chosen.push(topic.pattern);
      if (pairs.length === count * matchSize) break;
    }
  } else {
    const vectors = unique.flatMap((photo) => {
      const vector = Array.from(photo.vector);
      const norm = Math.hypot(...vector);
      return vector.length && vector.every(Number.isFinite) && norm > 0 && Number.isFinite(norm)
        ? [{ photo, vector: vector.map((v) => v / norm) }]
        : [];
    });
    const dimensions = new Map<number, number>();
    for (const item of vectors)
      dimensions.set(item.vector.length, (dimensions.get(item.vector.length) ?? 0) + 1);
    const dimension = [...dimensions].sort((a, b) => b[1] - a[1])[0]?.[0];
    const pool = shuffleGamePhotos(
      vectors.filter((item) => item.vector.length === dimension),
      random,
    );
    if (matchSize > 2) {
      const groups: Array<{ members: typeof pool; affinity: number }> = [];
      for (const anchor of pool) {
        if (used.has(anchor.photo.path)) continue;
        const others = pool
          .filter((item) => item !== anchor && !used.has(item.photo.path))
          .sort((a, b) => dot(anchor.vector, b.vector) - dot(anchor.vector, a.vector));
        const members = [anchor, ...others.slice(0, matchSize - 1)];
        if (members.length !== matchSize) continue;
        const affinity = Math.min(
          ...members.flatMap((item, i) =>
            members.slice(i + 1).map((other) => dot(item.vector, other.vector)),
          ),
        );
        if (
          affinity < 0.4 ||
          groups.some((group) =>
            members.some((item) =>
              group.members.some(
                (other) =>
                  dot(item.vector, other.vector) >= Math.min(affinity, group.affinity) - 0.0001,
              ),
            ),
          )
        )
          continue;
        const pair = groups.length;
        for (const item of members) {
          used.add(item.photo.path);
          pairs.push({ photo: item.photo, pair });
        }
        groups.push({ members, affinity });
        if (groups.length === count) break;
      }
      return pairs.length === count * matchSize ? shuffleGamePhotos(pairs, random) : null;
    }
    const dealtVectors: number[][] = [];
    for (const anchor of pool) {
      if (used.has(anchor.photo.path)) continue;
      let best: typeof anchor | undefined;
      let score = -Infinity;
      for (const other of pool) {
        if (other === anchor || used.has(other.photo.path)) continue;
        const similarity = dot(anchor.vector, other.vector);
        if (similarity > score) {
          score = similarity;
          best = other;
        }
      }
      if (!best) break;
      // A card must resemble its own partner more than another card on this board.
      if (
        score < 0.4 ||
        dealtVectors.some(
          (vector) =>
            Math.max(dot(vector, anchor.vector), dot(vector, best!.vector)) >= score - 0.0001,
        )
      )
        continue;
      if (
        pool.some(
          (other) =>
            other !== anchor &&
            other !== best &&
            !used.has(other.photo.path) &&
            dot(best!.vector, other.vector) > score + 1e-9,
        )
      )
        continue;
      const pair = pairs.length / matchSize;
      for (const photo of [anchor.photo, best.photo]) {
        used.add(photo.path);
        pairs.push({ photo, pair });
      }
      dealtVectors.push(anchor.vector, best.vector);
      if (pairs.length === count * matchSize) break;
    }
  }
  return pairs.length === count * matchSize ? shuffleGamePhotos(pairs, random) : null;
};

/** Keep solved cards fixed while the remaining identities move to new positions. */
export const shuffleUnmatched = (
  cards: PairCard[],
  matched: number[],
  random = Math.random,
): PairCard[] => {
  const remaining = shuffleGamePhotos(
    cards.filter((_, i) => !matched.includes(i)),
    random,
  );
  const original = cards.filter((_, i) => !matched.includes(i));
  if (remaining.length > 1 && remaining.every((card, i) => card === original[i])) {
    [remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!];
  }
  let next = 0;
  return cards.map((card, i) => (matched.includes(i) ? card : remaining[next++]!));
};
