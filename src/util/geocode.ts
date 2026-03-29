// Geocode strings stored in SQLite are produced by format_mapping_values() in index.py,
// which serialises the reverse_geocode result dict values one-per-line:
//   lat\nlon\nname\nadmin1\nadmin2\ncc\ncountry
// e.g. "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan"

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

const getGeocodeParts = (
  geocode: string | null | undefined,
): string[] => {
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
export function getGeocodeLabel(
  geocode: string | null | undefined,
): string | null {
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
export function getGeocodeCountry(
  geocode: string | null | undefined,
): string | null {
  const lines = getGeocodeParts(geocode);
  return lines.at(-1) ?? null;
}

/**
 * Returns city (first meaningful line) from a geocode string.
 */
export function getGeocodeCity(
  geocode: string | null | undefined,
): string | null {
  const lines = getGeocodeParts(geocode);
  return lines[0] ?? null;
}

export function getGeocodeRegion(
  geocode: string | null | undefined,
): string | null {
  const lines = getGeocodeParts(geocode);
  return lines[1] ?? null;
}

export function getGeocodeSubregion(
  geocode: string | null | undefined,
): string | null {
  const lines = getGeocodeParts(geocode);
  return lines[2] ?? null;
}
