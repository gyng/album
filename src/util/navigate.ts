export const navigateTo = (url: string) => window.location.assign(url);

/**
 * Reload the document, adding no history entry.
 *
 * Not `location.replace(location.href)`: when the URL carries a fragment, that
 * is a same-document navigation — the browser scrolls to the anchor and never
 * refetches. Album URLs carry a photo anchor (`/album/x#DSCF2389.JPG`), so the
 * stale-deploy banner's Reload button did nothing on exactly the pages most
 * likely to raise it. `reload()` refetches whatever the URL is, and like
 * `replace` it does not push history.
 */
export const reloadCurrentPage = () => window.location.reload();
