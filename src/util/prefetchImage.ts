/**
 * Fetch the photograph a link is about to need, while the reader is still
 * deciding to press it.
 *
 * A page's data is prefetched by the router; its photographs are not, so the
 * album a reader opens from the home page starts loading its first image only
 * once the navigation has finished. The pointer arrives some hundreds of
 * milliseconds before the press, which is the whole of that head start.
 *
 * `srcset` and `sizes` rather than one chosen URL: the browser picks the
 * candidate it would pick on the next page, at the same viewport, so the fetch
 * lands in the HTTP cache under the exact URL that page will ask for. Choosing
 * a width here would be guessing at a layout that has not happened yet, and a
 * miss costs a whole image of bandwidth for nothing.
 */

const started = new Set<string>();

/** Cleared between tests; nothing else has any reason to call this. */
export const resetPrefetchedImages = (): void => {
  started.clear();
};

export const prefetchImageSrcSet = (
  sources: ReadonlyArray<{ src: string; width: number }>,
  sizes: string,
): void => {
  if (sources.length === 0 || typeof Image === "undefined") return;

  const key = sources.map((source) => source.src).join("|");
  if (started.has(key)) return;

  // A reader who has asked for less data has asked for less data.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;

  started.add(key);

  const image = new Image();
  // `sizes` before `srcset`: the candidate is chosen when the source set is
  // assigned, and a source set assigned first is chosen against the default.
  image.sizes = sizes;
  image.srcset = sources.map((source) => `${source.src} ${source.width}w`).join(", ");
};
