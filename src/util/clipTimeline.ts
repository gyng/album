/**
 * One window of a clip's timeline (index/clip_timeline.py): what it shows, and
 * — only where two independent readings agreed — what is said in it.
 */
export type ClipTimelineSegment = {
  /** Seconds into the clip. */
  start: number;
  end: number;
  description?: string;
  speech?: string;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * `metadata.timeline_json`, checked segment by segment: it travels into page
 * props, and a segment without a usable time cannot be linked to its moment.
 */
export const parseClipTimeline = (
  raw: string | null | undefined,
): ClipTimelineSegment[] | undefined => {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const segments = parsed.flatMap((item): ClipTimelineSegment[] => {
    if (typeof item !== "object" || item === null) return [];
    const { start, end, description, speech } = item as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number") return [];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const said = text(speech);
    const shown = text(description);
    if (!said && !shown) return [];
    return [
      {
        start,
        end,
        ...(shown !== undefined ? { description: shown } : {}),
        ...(said !== undefined ? { speech: said } : {}),
      },
    ];
  });
  return segments.length > 0 ? segments : undefined;
};
