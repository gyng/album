import type { PhotoGamePhoto } from "./photoGames";

// Concrete visible subjects, rather than moods or the indexing model's abstract tags.
export const PHOTO_SUBJECTS: ReadonlyArray<{ answer: string; pattern: RegExp }> = [
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

// Each subject's derived patterns, compiled once rather than on every photograph.
const compiled = new WeakMap<RegExp, { mentions: RegExp; tag: RegExp }>();
const compile = (pattern: RegExp) => {
  let entry = compiled.get(pattern);
  if (!entry) {
    entry = {
      mentions: new RegExp(pattern.source, "gi"),
      tag: new RegExp(`^(?:${pattern.source})$`, "i"),
    };
    compiled.set(pattern, entry);
  }
  return entry;
};

const captionMentions = (caption: string, pattern: RegExp): number[] =>
  // matchAll clones its regular expression, so the shared one keeps no state.
  [...caption.matchAll(compile(pattern).mentions)].flatMap((mention) => {
    const prefix = caption.slice(Math.max(0, mention.index! - 60), mention.index);
    const suffix = caption.slice(mention.index! + mention[0].length);
    if (/^trains?$/i.test(mention[0]) && /^\s+(?:stations?|tracks?|platforms?)\b/i.test(suffix))
      return [];
    if (/^dogs?$/i.test(mention[0]) && /\bhot\s+$/i.test(prefix)) return [];
    return /\b(?:no|without|not|absence of)\s+(?:[\w-]+\s+){0,2}$/i.test(prefix)
      ? []
      : [mention.index!];
  });

export const photoSubjectClarity = (photo: PhotoGamePhoto, pattern: RegExp): number | null => {
  // Most captions never name the subject; one test settles those without collecting matches.
  const named = pattern.test(photo.caption);
  const mentions = named ? captionMentions(photo.caption, pattern) : [];
  if (!mentions.length) {
    // An explicit negation outranks a generic tag left by the indexer.
    if (named) return null;
    const tagPattern = compile(pattern).tag;
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
