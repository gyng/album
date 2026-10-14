// A Guess Where game can be dealt from named photographs: `/fun/guess?photos=…`
// with one repeated parameter per archive path, in round order. Paths stay raw
// (`../albums/<album>/<file>`, the search database's key); URLSearchParams does
// the encoding, so a space or an ü survives the round trip exactly once.

export const GUESS_PHOTO_LIMIT = 10;
const PARAM = "photos";

const isArchivePath = (value: string): boolean => {
  const parts = value.split("/");
  return (
    parts.length === 4 &&
    parts[0] === ".." &&
    parts[1] === "albums" &&
    parts.slice(2).every((part) => part !== "" && part !== "." && part !== "..")
  );
};

const distinct = (paths: Iterable<string>): string[] =>
  [...new Set(paths)].filter(isArchivePath).slice(0, GUESS_PHOTO_LIMIT);

/** The photographs a link asks Guess Where to deal; empty when it names none. */
export const guessPhotosFromParams = (params: URLSearchParams): string[] =>
  distinct(params.getAll(PARAM));

/** A Guess Where game dealing exactly these photographs, in this order. */
export const guessWherePath = (paths: readonly string[]): string => {
  const params = new URLSearchParams();
  for (const path of distinct(paths)) params.append(PARAM, path);
  return `/fun/guess?${params.toString()}`;
};
