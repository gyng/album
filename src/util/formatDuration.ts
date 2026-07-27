/**
 * A clip's length as m:ss (or h:mm:ss), for badges beside a video's poster.
 * Returns nothing when there is no usable length, so callers can omit the label
 * entirely rather than render a placeholder.
 */
export const formatDuration = (seconds: number | undefined): string | undefined => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const paddedSeconds = String(remainder).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
};
