// Pure decision cores for the slideshow's kiosk self-refresh polls. The fetch,
// interval and visibility plumbing stay in the page; these just encode the
// branching so the subtle "never refresh on the first observation" rule is
// unit-tested.

export type DbUpdateAction = "seed" | "none" | "refresh-in-place";

// Given the version observed from the search DB's ETag/Last-Modified, the last
// version we recorded, decide what to do:
// - seed: first observation — record it, do nothing (a cold start must never
//   mistake "never seen this header" for a change and refresh)
// - none: unchanged
// - refresh-in-place: changed during a live kiosk session — swap the database
//   and pool without tearing down the document
export const decideDbUpdateAction = (input: {
  observedVersion: string;
  lastVersion: string | null;
}): DbUpdateAction => {
  if (input.lastVersion === null) {
    return "seed";
  }
  if (input.observedVersion === input.lastVersion) {
    return "none";
  }
  return "refresh-in-place";
};

// True when a newer build manifest is available: a non-empty (trimmed) latest
// version that differs from the one this bundle was built with.
export const decideBuildUpdate = (
  latest: string | undefined,
  current: string,
): boolean => {
  const trimmed = latest?.trim();
  return !!trimmed && trimmed !== current;
};
