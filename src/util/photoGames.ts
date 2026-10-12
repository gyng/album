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
  return norm && Number.isFinite(norm) ? values.map((value) => value / norm) : null;
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
  const seen = new Set<string>();
  const validVectors = photos.flatMap((photo) => {
    const vector = normalise(photo.vector);
    if (!vector || seen.has(photo.path)) return [];
    seen.add(photo.path);
    return [{ photo, vector }];
  });
  const dimensions = new Map<number, number>();
  for (const item of validVectors)
    dimensions.set(item.vector.length, (dimensions.get(item.vector.length) ?? 0) + 1);
  const dimension = [...dimensions].sort((a, b) => b[1] - a[1])[0]?.[0];
  const vectors = validVectors.filter((item) => item.vector.length === dimension);
  if (vectors.length < 7) return null;
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
  const usedVectors = [first.vector, last.vector];
  for (let step = 1; step <= 5; step++) {
    const t = step / 6;
    const query =
      normalise(first.vector.map((value, i) => value * (1 - t) + last.vector[i]! * t)) ??
      first.vector;
    const ranked = candidates
      .filter((item) => !used.has(item.photo.path))
      .sort((a, b) => dot(query, b.vector) - dot(query, a.vector));
    // Prefer distinct frames over duplicate exports/burst copies. A small
    // archive can still complete a round when no diverse alternative exists.
    const next =
      ranked.find((item) => usedVectors.every((vector) => dot(vector, item.vector) < 0.98)) ??
      ranked[0]!;
    tiles.push(next.photo);
    usedVectors.push(next.vector);
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
  const middle = Math.floor(ranked.length / 2);
  const typicalSimilarity =
    ranked.length % 2
      ? ranked[middle]!.similarity
      : (ranked[middle - 1]!.similarity + ranked[middle]!.similarity) / 2;
  const bestSimilarity = ranked[0]!.similarity;
  // A high archive percentile can still be a weak match: most photographs
  // are unrelated to any one sketch. Reward similarity above a typical match,
  // scaled against the closest match, rather than the number of worse photos.
  const score =
    bestSimilarity - typicalSimilarity < 1e-9
      ? targetSimilarity >= bestSimilarity - 1e-9
        ? 100
        : 0
      : Math.round(
          100 *
            Math.max(
              0,
              Math.min(
                1,
                (targetSimilarity - typicalSimilarity) / (bestSimilarity - typicalSimilarity),
              ),
            ),
        );
  return {
    nearest: ranked[0]!.photo,
    rank,
    total: ranked.length,
    score,
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
    /\b(person|people|man|woman|men|women|child|children|crowds?|pedestrians?|portraits?|boys?|girls?)\b/i,
  ],
  [
    "water",
    "Is there water in the scene?",
    /\b(water|sea|ocean|rivers?|lakes?|harbou?rs?|canals?|ponds?|reservoirs?)\b/i,
  ],
  [
    "buildings",
    "Does it show buildings?",
    /\b(buildings?|architecture|houses?|skyscrapers?|facades?|façades?|temples?|church(?:es)?|shopfronts?)\b/i,
  ],
  [
    "greenery",
    "Does it show trees or plants?",
    /\b(trees?|forests?|plants?|gardens?|foliage|flowers?|grass|parks?)\b/i,
  ],
  [
    "transport",
    "Is there a vehicle?",
    /\b(cars?|trains?(?!\s+station\b)|bus(?:es)?|trucks?|bicycles?|bikes?|motorcycles?|trams?|boats?|ships?|planes?|vehicles?)\b/i,
  ],
  ["night", "Is it a night scene?", /\b(night|nighttime|nightscape)\b/i],
  [
    "indoors",
    "Was it photographed indoors?",
    /\b(interiors?|indoors|rooms?|bedrooms?|kitchens?|hallways?|corridors?)\b|\binside (?:a |an |the )?(?:cafe|café|restaurant|building|house|shop|station)\b/i,
  ],
  [
    "animals",
    "Is there an animal?",
    /\b(cats?|dogs?|birds?|animals?|fish|horses?|insects?|butterfl(?:y|ies))\b/i,
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
  ["sky", "Can you see the sky?", /\b(sky|clouds|cloudy|sunset|sunrise|horizon)\b/i],
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
  ["windows", "Can you see windows?", /\b(windows?|windowpanes?)\b/i],
  ["doors", "Does it show a door or doorway?", /\b(doors?|doorways?|entrances?)\b/i],
  ["flowers", "Does it show flowers?", /\b(flowers?|blossoms?|blooms?)\b/i],
  ["stairs", "Does it show stairs or steps?", /\b(stairs?|staircases?|stairways?|steps?)\b/i],
  ["red", "Is there something red?", /\bred\b/i],
  ["blue", "Is there something blue?", /\bblue\b/i],
  ["yellow", "Is there something yellow?", /\byellow\b/i],
];
const matchesVisibleTopic = (photo: PhotoGamePhoto, pattern: RegExp): boolean => {
  const mentions = [...photo.caption.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (mentions.length)
    return mentions.some((mention) => {
      const prefix = photo.caption.slice(Math.max(0, mention.index! - 60), mention.index);
      return !/\b(?:no|without|not|absence of)\s+(?:[\w-]+\s+){0,2}$/i.test(prefix);
    });
  return pattern.test(photo.tags);
};

export const ORACLE_QUESTIONS: OracleQuestion[] = topics.map(([id, label, pattern]) => ({
  id,
  label,
  matches: (photo) => matchesVisibleTopic(photo, pattern),
}));

export const buildOracleCohort = (
  photos: PhotoGamePhoto[],
  limit = 12,
  random: () => number = Math.random,
): PhotoGamePhoto[] => {
  const signatures = new Set<string>();
  const cohort: PhotoGamePhoto[] = [];
  for (const photo of shuffleGamePhotos(
    photos.filter((photo) => photo.caption || photo.tags),
    random,
  )) {
    const signature = ORACLE_QUESTIONS.map((question) => +question.matches(photo)).join("");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    cohort.push(photo);
    if (cohort.length >= limit) break;
  }
  return cohort;
};

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
