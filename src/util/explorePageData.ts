import type { PhotoStats } from "./computeStats";

// Lossless rows for the two per-photo ribbons. Strings shared between gear and
// colour (photo URLs, labels, dates and categories) travel only once.
type FrameRow = [
  number,
  number,
  number,
  number | null,
  number | null,
  number,
  number,
  number,
  number,
];
type SliceRow = [number, number, number, number, number, number, number, [number, number] | null];
export type PackedExploreStats = Omit<PhotoStats, "gear" | "colorYearRibbons"> & {
  strings: string[];
  gear: Omit<PhotoStats["gear"], "frames">;
  frameRows: FrameRow[];
  colourRows: Array<
    [number, number, number | null, SliceRow[], { family: number | null; count: number } | null]
  >;
};

export const packExploreStats = (stats: PhotoStats): PackedExploreStats => {
  const strings: string[] = [];
  const indices = new Map<string, number>();
  const intern = (value: string): number => {
    const existing = indices.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    indices.set(value, index);
    return index;
  };
  const {
    gear: { frames, ...gear },
    colorYearRibbons,
    ...rest
  } = stats;
  const frameRows: FrameRow[] = frames.map((f) => [
    intern(f.year),
    f.position,
    intern(f.camera),
    f.lens === null ? null : intern(f.lens),
    f.band === null ? null : intern(f.band),
    intern(f.src),
    intern(f.href),
    intern(f.label),
    intern(f.dateLabel),
  ]);
  const colourRows: PackedExploreStats["colourRows"] = colorYearRibbons.map((year) => [
    intern(year.label),
    year.total,
    year.dominantFamily === null ? null : intern(year.dominantFamily),
    year.slices.map((s) => [
      intern(s.rgb),
      intern(s.family),
      s.count,
      s.position,
      intern(s.dateLabel),
      intern(s.thumbSrc),
      intern(s.photoLabel),
      s.accent ? [intern(s.accent.family), intern(s.accent.rgb)] : null,
    ]),
    year.accentFamily === undefined
      ? null
      : {
          family: year.accentFamily === null ? null : intern(year.accentFamily),
          count: year.accentCount ?? 0,
        },
  ]);
  return { ...rest, gear, strings, frameRows, colourRows };
};

export const unpackExploreStats = (packed: PackedExploreStats): PhotoStats => {
  const { strings, frameRows, colourRows, gear, ...rest } = packed;
  return {
    ...rest,
    gear: {
      ...gear,
      frames: frameRows.map(
        ([year, position, camera, lens, band, src, href, label, dateLabel]) => ({
          year: strings[year]!,
          position,
          camera: strings[camera]!,
          lens: lens === null ? null : strings[lens]!,
          band: band === null ? null : strings[band]!,
          src: strings[src]!,
          href: strings[href]!,
          label: strings[label]!,
          dateLabel: strings[dateLabel]!,
        }),
      ),
    },
    colorYearRibbons: colourRows.map(([label, total, dominantFamily, slices, accent]) => ({
      label: strings[label]!,
      total,
      dominantFamily: dominantFamily === null ? null : strings[dominantFamily]!,
      ...(accent
        ? {
            accentFamily: accent.family === null ? null : strings[accent.family]!,
            accentCount: accent.count,
          }
        : {}),
      slices: slices.map(
        ([rgb, family, count, position, dateLabel, thumbSrc, photoLabel, accent]) => ({
          rgb: strings[rgb]!,
          family: strings[family]!,
          count,
          position,
          dateLabel: strings[dateLabel]!,
          thumbSrc: strings[thumbSrc]!,
          photoLabel: strings[photoLabel]!,
          ...(accent ? { accent: { family: strings[accent[0]]!, rgb: strings[accent[1]]! } } : {}),
        }),
      ),
    })),
  };
};
