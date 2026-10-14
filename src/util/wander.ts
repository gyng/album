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
  "src" | "href" | "tags" | "swatch" | "near" | "around"
>;

export type WanderExit = { index: number; label: string };

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

/**
 * Up to `count` ways out of a photograph, closest first. The nearest always
 * leads ("closest"); every other exit must bring something the others do not,
 * so six exits are six directions rather than six frames of one burst. Places
 * already walked are used only when nothing else is left.
 */
export const wanderExits = (
  entries: readonly WanderEntry[],
  current: number,
  visited: ReadonlySet<number> = new Set(),
  count = 6,
): WanderExit[] => {
  const here = entries[current];
  if (!here) return [];
  const all = [...(here.near ?? []), ...(here.around ?? [])].filter(
    (index, position, list) =>
      index !== current && entries[index] !== undefined && list.indexOf(index) === position,
  );
  const fresh = all.filter((index) => !visited.has(index));
  const candidates = fresh.length ? fresh : all;
  if (!candidates.length) return [];
  const own = new Set(here.tags ?? []);
  const [first, ...rest] = candidates as [number, ...number[]];
  const exits: WanderExit[] = [{ index: first, label: "closest" }];
  const used = new Set(["closest"]);
  for (const index of rest) {
    if (exits.length >= count) break;
    const entry = entries[index]!;
    const subjects = (entry.tags ?? []).filter((tag) => !own.has(tag));
    const label = [...subjects, ...colourLabels(here, entry)].find((item) => !used.has(item));
    if (!label) continue;
    used.add(label);
    exits.push({ index, label });
  }
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
