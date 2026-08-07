/**
 * Every year between the first and the last, including the ones with nothing
 * in them.
 *
 * A year-by-year chart built from the years that have photographs skips the
 * ones that do not, and the axis silently closes the gap: 2019 sits against
 * 2022 as though they were consecutive, and a three-year silence — which is
 * itself a fact about an archive — cannot be seen at all. An empty year is a
 * row with an empty bar, which is what it should look like.
 */
export const fillYearRange = <T>(
  years: Map<string, T>,
  empty: (year: string) => T,
): Array<[string, T]> => {
  const numbers = [...years.keys()].map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return [];

  const first = Math.min(...numbers);
  const last = Math.max(...numbers);

  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const year = String(first + offset);
    return [year, years.get(year) ?? empty(year)] as [string, T];
  });
};
