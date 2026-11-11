/**
 * Which moment of a clip a keyword search is about.
 *
 * A clip's timeline (`metadata.timeline_json`: what happens and what is said,
 * window by window) is searchable text, so a phrase said forty seconds in finds
 * the clip — and then opened it at its first frame. This picks the window the
 * words are in, so the result can link to it.
 */
export type TimelineMoment = {
  /** Seconds into the clip. */
  start: number;
  /** The window's own words: its speech if that is what matched, else its description. */
  text: string;
};

type Segment = { start?: unknown; description?: unknown; speech?: unknown };

const termsOf = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3);

const countMatches = (text: string, terms: string[]): number => {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length;
};

export const matchTimelineMoment = (
  timelineJson: string | null | undefined,
  query: string,
): TimelineMoment | null => {
  const terms = termsOf(query);
  if (!timelineJson || terms.length === 0) return null;

  let segments: unknown;
  try {
    segments = JSON.parse(timelineJson);
  } catch {
    return null;
  }
  if (!Array.isArray(segments)) return null;

  let best: (TimelineMoment & { score: number }) | null = null;
  for (const segment of segments as Segment[]) {
    if (typeof segment?.start !== "number" || !Number.isFinite(segment.start)) continue;
    const speech = typeof segment.speech === "string" ? segment.speech : "";
    const description = typeof segment.description === "string" ? segment.description : "";
    const speechScore = countMatches(speech, terms);
    const descriptionScore = countMatches(description, terms);
    const score = Math.max(speechScore, descriptionScore);
    // Strictly greater: of equally good windows, the earliest is where it starts.
    if (score > 0 && score > (best?.score ?? 0)) {
      best = {
        start: segment.start,
        text: speechScore >= descriptionScore && speech ? speech : description,
        score,
      };
    }
  }
  return best ? { start: best.start, text: best.text } : null;
};

/** "/album/trip#clip.mov" → "/album/trip?t=42#clip.mov". */
export const withMoment = (albumHref: string, seconds: number): string => {
  const hashAt = albumHref.indexOf("#");
  if (hashAt === -1 || albumHref.includes("?")) return albumHref;
  return `${albumHref.slice(0, hashAt)}?t=${Math.round(seconds)}${albumHref.slice(hashAt)}`;
};
