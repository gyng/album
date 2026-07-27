/**
 * A search hit on a moment inside a clip links to "?t=<seconds>#<clip>". The
 * page scrolls to the clip like any other anchor; this seeks it to the frame
 * the viewer was shown, rather than starting the clip from the top.
 */
export const seekLinkedMoment = (
  getSearchParam: (name: string) => string | null,
  hash: string = window.location.hash,
): void => {
  const seconds = Number(getSearchParam("t"));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return;
  }

  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return;
  // A malformed percent-sequence throws URIError; the raw hash is the fallback,
  // matching how the anchor itself is resolved.
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }

  // The anchor element is the clip's details panel; the video is its sibling
  // inside the block, which carries the same id as a data attribute for exactly
  // this lookup.
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  let video: HTMLVideoElement | null = null;
  try {
    video = document.querySelector<HTMLVideoElement>(`[data-media-id="${escaped}"] video`);
  } catch {
    return;
  }
  if (!video) return;

  const seek = () => {
    // A stale link — a clip re-exported shorter — would otherwise seek past the
    // end and be ignored, leaving the viewer at the start with no explanation.
    video.currentTime = video.duration > 0 ? Math.min(seconds, video.duration) : seconds;
  };

  if (video.readyState >= 1) {
    seek();
    return;
  }
  video.addEventListener("loadedmetadata", seek, { once: true });
};
