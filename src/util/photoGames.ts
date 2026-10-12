export type PhotoGamePhoto = {
  path: string;
  href: string;
  caption: string;
  tags: string;
  vector: number[] | Float32Array;
};

export const photoGameCaption = (value: string): string =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalise = (vector: ArrayLike<number>): number[] | null => {
  const values = Array.from(vector);
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  const norm = Math.hypot(...values);
  return norm ? values.map((value) => value / norm) : null;
};

const dot = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length) return 0;
  let total = 0;
  for (let i = 0; i < left.length; i++) total += left[i]! * right[i]!;
  return total;
};

export const shuffleGamePhotos = <T>(
  values: readonly T[],
  random: () => number = Math.random,
): T[] => {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

export type RelayPuzzle = {
  start: PhotoGamePhoto;
  end: PhotoGamePhoto;
  tiles: PhotoGamePhoto[];
  solution: PhotoGamePhoto[];
};

const relayRoutes = (puzzle: Pick<RelayPuzzle, "start" | "end" | "tiles">) => {
  const vectors = new Map(
    [puzzle.start, ...puzzle.tiles, puzzle.end].map((photo) => [
      photo.path,
      normalise(photo.vector)!,
    ]),
  );
  const routes: { order: PhotoGamePhoto[]; smoothness: number }[] = [];
  const visit = (order: PhotoGamePhoto[], remaining: PhotoGamePhoto[], smoothness: number) => {
    const previous = order.at(-1) ?? puzzle.start;
    if (!remaining.length) {
      routes.push({
        order,
        smoothness: smoothness + dot(vectors.get(previous.path)!, vectors.get(puzzle.end.path)!),
      });
      return;
    }
    for (const next of remaining)
      visit(
        [...order, next],
        remaining.filter((photo) => photo.path !== next.path),
        smoothness + dot(vectors.get(previous.path)!, vectors.get(next.path)!),
      );
  };
  visit([], puzzle.tiles, 0);
  return routes.sort((a, b) => b.smoothness - a.smoothness);
};

// Interpolation gives the tray a visual progression; the best ordering of its
// five photographs is then solved exhaustively (only 120 permutations).
export const buildRelayPuzzle = (
  photos: PhotoGamePhoto[],
  random: () => number = Math.random,
): RelayPuzzle | null => {
  const vectors = photos.flatMap((photo) => {
    const vector = normalise(photo.vector);
    return vector ? [{ photo, vector }] : [];
  });
  const first = shuffleGamePhotos(vectors, random)[0];
  if (!first) return null;
  const candidates = vectors
    .filter(
      (item) => item.photo.path !== first.photo.path && item.vector.length === first.vector.length,
    )
    .sort((a, b) => dot(first.vector, b.vector) - dot(first.vector, a.vector));
  if (candidates.length < 6) return null;
  const last = candidates[Math.min(candidates.length - 1, Math.floor(candidates.length * 0.7))]!;
  const used = new Set([first.photo.path, last.photo.path]);
  const tiles: PhotoGamePhoto[] = [];
  for (let step = 1; step <= 5; step++) {
    const t = step / 6;
    const query =
      normalise(first.vector.map((value, i) => value * (1 - t) + last.vector[i]! * t)) ??
      first.vector;
    const next = candidates
      .filter((item) => !used.has(item.photo.path))
      .sort((a, b) => dot(query, b.vector) - dot(query, a.vector))[0]!;
    tiles.push(next.photo);
    used.add(next.photo.path);
  }
  const base = { start: first.photo, end: last.photo, tiles };
  return {
    ...base,
    tiles: shuffleGamePhotos(tiles, random),
    solution: relayRoutes(base)[0]!.order,
  };
};

export const scoreRelay = (puzzle: RelayPuzzle, order: PhotoGamePhoto[]): number | null => {
  if (
    order.length !== puzzle.tiles.length ||
    new Set(order.map((photo) => photo.path)).size !== puzzle.tiles.length ||
    order.some((photo) => !puzzle.tiles.some((tile) => tile.path === photo.path))
  )
    return null;
  const routes = relayRoutes(puzzle);
  const matching = routes.find((route) =>
    route.order.every((photo, i) => photo.path === order[i]?.path),
  );
  if (!matching) return null;
  const best = routes[0]!.smoothness;
  const worst = routes.at(-1)!.smoothness;
  return best - worst < 1e-9
    ? 100
    : Math.round((100 * (matching.smoothness - worst)) / (best - worst));
};

export const rankDrawing = (vector: number[], photos: PhotoGamePhoto[], targetPath: string) => {
  const query = normalise(vector);
  if (!query) return null;
  const ranked = photos
    .flatMap((photo) => {
      const candidate = normalise(photo.vector);
      return candidate?.length === query.length
        ? [{ photo, similarity: dot(query, candidate) }]
        : [];
    })
    .sort((a, b) => b.similarity - a.similarity || a.photo.path.localeCompare(b.photo.path));
  const targetIndex = ranked.findIndex((item) => item.photo.path === targetPath);
  if (targetIndex < 0) return null;
  const targetSimilarity = ranked[targetIndex]!.similarity;
  // Equal similarities share a rank, so an arbitrary path order cannot
  // penalise a drawing that matches several photographs equally well.
  const rank = ranked.filter((item) => item.similarity > targetSimilarity + 1e-9).length + 1;
  return {
    nearest: ranked[0]!.photo,
    rank,
    total: ranked.length,
    score:
      ranked.length === 1 ? 100 : Math.round((100 * (ranked.length - rank)) / (ranked.length - 1)),
  };
};

export type OracleCandidate = { photo: PhotoGamePhoto; weight: number };
export type OracleQuestion = {
  id: string;
  label: string;
  matches: (photo: PhotoGamePhoto) => boolean;
};
const topics: Array<[string, string, RegExp]> = [
  [
    "people",
    "Are there people in the photograph?",
    /\b(person|people|man|woman|men|women|child|children|crowd|pedestrian|portrait|boy|girl)\b/i,
  ],
  [
    "water",
    "Is there water in the scene?",
    /\b(water|sea|ocean|river|lake|harbou?r|canal|pond|beach|boat)\b/i,
  ],
  [
    "buildings",
    "Are buildings a prominent part of the scene?",
    /\b(building|buildings|architecture|house|houses|skyscraper|facade|façade|temple|church|shopfront)\b/i,
  ],
  [
    "greenery",
    "Does it show trees or plants?",
    /\b(tree|trees|forest|plant|plants|garden|foliage|flower|flowers|grass|park)\b/i,
  ],
  [
    "transport",
    "Is there a vehicle?",
    /\b(car|cars|train|bus|truck|bicycle|bike|motorcycle|tram|boat|ship|plane|vehicle)\b/i,
  ],
  ["night", "Is it a night scene?", /\b(night|nighttime|darkness|neon|illuminated|nightscape)\b/i],
  [
    "indoors",
    "Was it photographed indoors?",
    /\b(interior|indoors|room|bedroom|kitchen|restaurant|cafe|café|hallway|corridor)\b/i,
  ],
  [
    "animals",
    "Is there an animal?",
    /\b(cat|dog|bird|birds|animal|animals|fish|horse|insect|butterfly)\b/i,
  ],
  [
    "food",
    "Does it show food or a drink?",
    /\b(food|meal|dish|coffee|tea|drink|cake|bread|noodles|rice|sushi|breakfast)\b/i,
  ],
  [
    "mountains",
    "Are there hills or mountains?",
    /\b(mountain|mountains|hill|hills|hillside|peak|valley)\b/i,
  ],
  [
    "street",
    "Does it show a street or road?",
    /\b(street|road|alley|pavement|sidewalk|crossing|intersection|highway)\b/i,
  ],
  ["sky", "Is the sky prominent?", /\b(sky|clouds|cloudy|sunset|sunrise|horizon)\b/i],
  [
    "reflection",
    "Is there a reflection?",
    /\b(reflection|reflections|reflecting|mirror|mirrored)\b/i,
  ],
  [
    "sign",
    "Does it show a sign or lettering?",
    /\b(sign|signs|signage|lettering|billboard|poster|graffiti)\b/i,
  ],
  ["bridge", "Is there a bridge?", /\b(bridge|bridges|footbridge|overpass)\b/i],
  ["snow", "Does it show snow?", /\b(snow|snowy|snowfall|snow-covered)\b/i],
];
export const ORACLE_QUESTIONS: OracleQuestion[] = topics.map(([id, label, pattern]) => ({
  id,
  label,
  matches: (photo) => pattern.test(`${photo.caption} ${photo.tags}`),
}));

export const chooseOracleQuestion = (
  candidates: OracleCandidate[],
  asked: readonly string[],
): OracleQuestion | null => {
  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  let best: OracleQuestion | null = null;
  let balance = Infinity;
  for (const question of ORACLE_QUESTIONS) {
    if (asked.includes(question.id)) continue;
    const yes = candidates.reduce(
      (sum, item) => sum + (question.matches(item.photo) ? item.weight : 0),
      0,
    );
    if (yes <= 0 || yes >= total) continue;
    const distance = Math.abs(yes / total - 0.5);
    if (distance < balance) {
      best = question;
      balance = distance;
    }
  }
  return best;
};

// Captions can omit an object: answers update likelihoods rather than deleting
// every candidate that disagrees with one imperfect metadata observation.
export const answerOracle = (
  candidates: OracleCandidate[],
  question: OracleQuestion,
  answer: "yes" | "no" | "unsure",
): OracleCandidate[] => {
  if (answer === "unsure") return candidates;
  const updated = candidates.map((item) => ({
    ...item,
    weight: item.weight * (question.matches(item.photo) === (answer === "yes") ? 0.85 : 0.15),
  }));
  const total = updated.reduce((sum, item) => sum + item.weight, 0);
  return updated.map((item) => ({ ...item, weight: item.weight / total }));
};
