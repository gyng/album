// Geocode strings stored in SQLite are the place names, one per line, in
// order: city, region (admin1), subregion (admin2), country. These functions
// clean defensively (dropping any coordinate/country-code lines) so they parse
// both the current form and legacy blobs built before index.py stripped the
// coordinates out — e.g. "Shinjuku-ku\nTokyo\nTokyo\nJapan" or the older
// "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan".
// Exact facet filtering uses the dedicated metadata.geo_* columns (see
// build_geocode_fields in index.py); these positional labels/counts must stay
// consistent with those columns.

const isCoordinate = (line: string): boolean => /^-?\d+(?:\.\d+)?$/.test(line);
const isCountryCode = (line: string): boolean =>
  line.length <= 3 && line === line.toUpperCase() && /^[A-Z]+$/.test(line);

const cleanLines = (geocode: string): string[] =>
  geocode
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isCoordinate(line))
    .filter((line) => !isCountryCode(line));

const getGeocodeParts = (geocode: string | null | undefined): string[] => {
  if (!geocode) return [];
  return cleanLines(geocode);
};

/**
 * Returns a short human-readable location label from a stored geocode string.
 * Returns null when the string is empty or contains only coordinates/codes.
 *
 * Output examples:
 *   "Shinjuku-ku, Tokyo, Japan"  (name + admin1 + country, deduplicated)
 *   "Osaka, Japan"
 *   "Japan"
 */
export function getGeocodeLabel(geocode: string | null | undefined): string | null {
  if (!geocode) return null;

  const lines = cleanLines(geocode);
  if (lines.length === 0) return null;

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique = lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });

  return unique.join(", ");
}

/**
 * Returns just the country from a geocode string (last non-code, non-coord line).
 * Used for aggregating top locations by country.
 */
export function getGeocodeCountry(geocode: string | null | undefined): string | null {
  const lines = getGeocodeParts(geocode);
  return lines.at(-1) ?? null;
}

/**
 * Returns city (first meaningful line) from a geocode string.
 */
export function getGeocodeCity(geocode: string | null | undefined): string | null {
  const lines = getGeocodeParts(geocode);
  return lines[0] ?? null;
}

export function getGeocodeRegion(geocode: string | null | undefined): string | null {
  const lines = getGeocodeParts(geocode);
  return lines[1] ?? null;
}

export function getGeocodeSubregion(geocode: string | null | undefined): string | null {
  const lines = getGeocodeParts(geocode);
  return lines[2] ?? null;
}

const TRAILING_PLACE_SUFFIXES = [
  /\s*\([^)]*\)$/,
  /\bCity$/,
  /\bCounty$/,
  /\bDistrict$/,
  /\bPrefecture$/,
  /\bProvince$/,
  /\bState$/,
  /\bShi$/,
  /-shi$/,
  /\bKu$/,
  /-ku$/,
  /\bGun$/,
  /-gun$/,
];

export function formatPlaceDisplayLabel(value: string | null | undefined): string | null {
  if (!value) return null;

  let label = value.trim();
  if (!label) return null;

  // A label may stack suffixes (for example "Springfield (Illinois) City").
  // Repeat until stable so removing the outer suffix can expose another one.
  let previous: string;
  do {
    previous = label;
    TRAILING_PLACE_SUFFIXES.forEach((pattern) => {
      label = label.replace(pattern, "").trim();
    });
  } while (label !== previous);

  return label || value.trim();
}
