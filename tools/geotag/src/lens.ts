export type LensMetadata = {
  make: string;
  model: string;
  focalLength: number | null;
  focalLength35mm: number | null;
};

export type LensPreset = LensMetadata & {
  id: string;
  name: string;
};

export type LensDraft = {
  name: string;
  make: string;
  model: string;
  focalLength: string;
  focalLength35mm: string;
};

const optionalPositiveNumber = (raw: string): number | null | "invalid" => {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : "invalid";
};

export const normaliseLensDraft = (
  draft: LensDraft,
): (LensMetadata & { name: string }) | null => {
  const model = draft.model.trim();
  const focalLength = optionalPositiveNumber(draft.focalLength);
  const focalLength35mm = optionalPositiveNumber(draft.focalLength35mm);
  if (!model || focalLength === "invalid" || focalLength35mm === "invalid") return null;

  return {
    name: draft.name.trim() || model,
    make: draft.make.trim(),
    model,
    focalLength,
    focalLength35mm,
  };
};

export const isLensMissing = (photo: { lensModel: string | null }): boolean =>
  !photo.lensModel?.trim();

export const lensSummary = (
  lens: Pick<LensMetadata, "make" | "model" | "focalLength" | "focalLength35mm">,
): string => {
  const identity = [lens.make, lens.model].filter(Boolean).join(" ");
  const focal = lens.focalLength ? `${lens.focalLength}mm` : null;
  const equivalent = lens.focalLength35mm ? `${lens.focalLength35mm}mm eq.` : null;
  return [identity, focal, equivalent].filter(Boolean).join(" · ");
};

export const assignLensToPhotos = (
  pending: Record<string, LensMetadata>,
  filenames: Iterable<string>,
  lens: LensMetadata,
): Record<string, LensMetadata> => {
  const next = { ...pending };
  for (const filename of filenames) next[filename] = lens;
  return next;
};

export const upsertLensPreset = (
  presets: LensPreset[],
  lens: LensMetadata & { name: string },
  createId: () => string,
): LensPreset[] => {
  const existing = presets.find(
    (preset) => preset.name.toLocaleLowerCase() === lens.name.toLocaleLowerCase(),
  );
  if (!existing) return [...presets, { ...lens, id: createId() }];
  return presets.map((preset) =>
    preset.id === existing.id ? { ...lens, id: existing.id } : preset,
  );
};

const validStoredNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);

export const parseLensPresets = (raw: string): LensPreset[] => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is LensPreset =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.name === "string" &&
        item.name.trim().length > 0 &&
        typeof item.make === "string" &&
        typeof item.model === "string" &&
        item.model.trim().length > 0 &&
        validStoredNumber(item.focalLength) &&
        validStoredNumber(item.focalLength35mm),
    );
  } catch {
    return [];
  }
};
