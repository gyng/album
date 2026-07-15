/**
 * Percent-encodes each segment of a site-relative asset path.
 *
 * Browsers auto-encode some characters in a src (ü → %C3%BC, space → %20) but
 * leave "@" raw. Next's production static serving rejects that mixed form for
 * any path that needs escaping at all — only the fully canonical encoding is
 * matched — so albums with non-ASCII or spaced names 404 in `next start`.
 * Raw spaces additionally break srcSet candidate parsing. Every emitted
 * public asset URL must therefore go through this exactly once.
 */
export const encodePublicAssetPath = (assetPath: string): string =>
  assetPath.split("/").map(encodeURIComponent).join("/");
