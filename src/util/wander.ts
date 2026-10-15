/**
 * Wander: a walk through the archive one photograph at a time, stepping to a
 * neighbour in the full embedding space. Pure, so the choice of exits and
 * quests is testable without the cloud or the page.
 *
 * Exits are labelled by what changes on the way — a subject the next
 * photograph has and this one lacks, or a shift in its colour — never by place
 * or date, which a walker cannot see.
 */
import { indexedPathFromSrc, type EmbeddingSpaceEntry } from "./embeddingSpaceData";

export type WanderEntry = Pick<
  EmbeddingSpaceEntry,
  "src" | "href" | "tags" | "swatch" | "near" | "around" | "cluster"
>;

export type WanderExit = { index: number; label: string };

const URBAN =
  /\b(streets?|city|cityscape|urban|buildings?|architecture|apartments?|skyscrapers?|storefront|downtown|skyline)\b/i;
export const WANDER_SCENES = [
  {
    id: "nature",
    label: "Nature",
    pattern:
      /\b(forests?|mountains?|woods?|woodland|landscape|hills?|fields?|meadows?|snow|desert|wildlife)\b/i,
  },
  {
    id: "water",
    label: "Water",
    pattern: /\b(water|ocean|sea|beach|coast|lakes?|rivers?|waterfalls?|canal)\b/i,
  },
  {
    id: "animals",
    label: "Animals",
    pattern: /\b(animals?|cats?|dogs?|birds?|wildlife|deer|fox|penguin|insects?|fish)\b/i,
  },
  {
    id: "people",
    label: "People",
    pattern: /\b(people|person|woman|women|man|men|child|children|portrait)\b/i,
  },
  {
    id: "food",
    label: "Food",
    pattern: /\b(food|meal|dish|dessert|coffee|cake|noodles|sushi|fruit)\b/i,
  },
  { id: "night", label: "Night", pattern: /\b(night|stars?|moon|milky way|fireworks)\b/i },
] as const;
export type WanderScene = (typeof WANDER_SCENES)[number]["id"];
const subjectText = (entry: WanderEntry) => (entry.tags ?? []).join(" ").replaceAll("_", " ");
const matchesScene = (entry: WanderEntry, scene: WanderScene) => {
  const text = subjectText(entry);
  return (
    WANDER_SCENES.find((item) => item.id === scene)!.pattern.test(text) &&
    (!(scene === "nature" || scene === "water") || !URBAN.test(text))
  );
};

/** Unexplored scene shortcuts, across the whole archive rather than only nearest neighbours. */
export const wanderScenes = (
  entries: readonly WanderEntry[],
  current: number,
  visited: ReadonlySet<number>,
) =>
  WANDER_SCENES.filter((scene) =>
    entries.some(
      (entry, index) => index !== current && !visited.has(index) && matchesScene(entry, scene.id),
    ),
  );

/** A genuinely wider step, favouring different subjects and escaping urban photographs. */
export const wanderJump = (
  entries: readonly WanderEntry[],
  current: number,
  visited: ReadonlySet<number> = new Set(),
  random: () => number = Math.random,
  scene?: WanderScene,
): number | null => {
  const here = entries[current];
  if (!here) return null;
  let candidates = entries.flatMap((entry, index) =>
    index !== current && !visited.has(index) && (!scene || matchesScene(entry, scene))
      ? [index]
      : [],
  );
  if (!candidates.length) return null;
  const neighbours = new Set([...(here.near ?? []), ...(here.around ?? [])]);
  const outside = candidates.filter((index) => !neighbours.has(index));
  if (outside.length) candidates = outside;
  if (!scene && URBAN.test(subjectText(here))) {
    const outsideCity = candidates.filter((index) => !URBAN.test(subjectText(entries[index]!)));
    if (outsideCity.length) candidates = outsideCity;
  }
  const own = new Set(here.tags ?? []);
  let best = -Infinity;
  let choices: number[] = [];
  for (const index of candidates) {
    const entry = entries[index]!;
    const tags = new Set(entry.tags ?? []);
    const shared = [...tags].filter((tag) => own.has(tag)).length;
    const union = new Set([...own, ...tags]).size;
    const novelty = own.size && tags.size ? 1 - shared / union : 0.5;
    const differentAlbum = entry.href.split("#")[0] !== here.href.split("#")[0];
    const differentCluster =
      here.cluster !== undefined && entry.cluster !== undefined && here.cluster !== entry.cluster;
    const score = novelty + Number(differentAlbum) * 0.1 + Number(differentCluster) * 0.1;
    if (score > best) {
      best = score;
      choices = [index];
    } else if (score === best) choices.push(index);
  }
  return (
    choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))] ??
    null
  );
};

const parseSwatch = (swatch: string | undefined) => {
  const match = swatch ? /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(swatch) : null;
  if (!match) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map((value) => Number(value) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return { lightness: (max + min) / 2, chroma: max - min, warmth: r - b };
};

/** How far a colour has to move before the step is worth naming. */
const COLOUR_SHIFT = 0.15;

const colourLabels = (from: WanderEntry, to: WanderEntry): string[] => {
  const a = parseSwatch(from.swatch);
  const b = parseSwatch(to.swatch);
  if (!a || !b) return [];
  const labels: string[] = [];
  if (b.lightness - a.lightness > COLOUR_SHIFT) labels.push("lighter");
  if (a.lightness - b.lightness > COLOUR_SHIFT) labels.push("darker");
  if (b.warmth - a.warmth > COLOUR_SHIFT) labels.push("warmer");
  if (a.warmth - b.warmth > COLOUR_SHIFT) labels.push("cooler");
  if (b.chroma - a.chroma > COLOUR_SHIFT) labels.push("more colourful");
  if (a.chroma - b.chroma > COLOUR_SHIFT) labels.push("quieter");
  return labels;
};

/** Local, labelled steps plus an unexplored exit beyond the current neighbourhood. */
export const wanderExits = (
  entries: readonly WanderEntry[],
  current: number,
  visited: ReadonlySet<number> = new Set(),
  count = 6,
): WanderExit[] => {
  const here = entries[current];
  if (!here || count < 1) return [];
  const all = [...(here.near ?? []), ...(here.around ?? [])].filter(
    (index, position, list) =>
      index !== current && entries[index] !== undefined && list.indexOf(index) === position,
  );
  const candidates = all.filter((index) => !visited.has(index));
  const jump = wanderJump(entries, current, new Set([...visited, ...all]), () => 0);
  const localLimit = count - Number(jump !== null);
  const exits: WanderExit[] = [];
  const used = new Set<string>();
  const own = new Set(here.tags ?? []);
  for (const index of candidates) {
    if (exits.length >= localLimit) break;
    const entry = entries[index]!;
    const subjects = (entry.tags ?? []).filter((tag) => !own.has(tag));
    const label =
      exits.length === 0
        ? "closest"
        : [...subjects, ...colourLabels(here, entry)].find((item) => !used.has(item));
    if (!label) continue;
    used.add(label);
    exits.push({ index, label });
  }
  if (jump !== null) exits.push({ index: jump, label: "further afield" });
  return exits;
};

export type WanderQuest = { tags: [string, string] };

/** A subject has to be this common to be worth looking for. */
const QUEST_TAG_MIN = 8;
/** And the pair this rare, so finding it takes a walk. */
const QUEST_PAIR_MAX = 5;

/**
 * A pair of subjects that appear together in a handful of photographs: a
 * direction for a walk, not a puzzle. Null when the archive has no such pair.
 */
export const wanderQuest = (
  entries: readonly WanderEntry[],
  random: () => number = Math.random,
): WanderQuest | null => {
  const tagCounts = new Map<string, number>();
  for (const entry of entries)
    for (const tag of new Set(entry.tags ?? [])) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const pairCounts = new Map<string, number>();
  for (const entry of entries) {
    const tags = [...new Set(entry.tags ?? [])]
      .filter((tag) => (tagCounts.get(tag) ?? 0) >= QUEST_TAG_MIN)
      .sort();
    for (let a = 0; a < tags.length; a += 1)
      for (let b = a + 1; b < tags.length; b += 1) {
        const key = `${tags[a]}\u0000${tags[b]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
  }
  const pairs = [...pairCounts]
    .filter(([, count]) => count <= QUEST_PAIR_MAX)
    .map(([key]) => key)
    .sort();
  const chosen = pairs[Math.floor(random() * pairs.length)];
  if (!chosen) return null;
  const [a, b] = chosen.split("\u0000") as [string, string];
  return { tags: [a, b] };
};

export const meetsQuest = (entry: WanderEntry | undefined, quest: WanderQuest | null): boolean =>
  Boolean(entry && quest && quest.tags.every((tag) => entry.tags?.includes(tag)));

/**
 * The URL form of a place on the walk: the search database's key, which a
 * photo page already knows and which survives a rebuild reordering the cloud.
 */
export const wanderKey = (entry: Pick<WanderEntry, "src">): string | null =>
  indexedPathFromSrc(entry.src);

export const findWanderEntry = (entries: readonly WanderEntry[], key: string | null): number =>
  key ? entries.findIndex((entry) => wanderKey(entry) === key) : -1;
