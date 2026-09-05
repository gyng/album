export const RUNTIME_HEARTBEAT_MS = 15000;
export const RUNTIME_HEALTH_TIMEOUT_MS = 45000;

export type SlideshowRuntimeHealth = {
  photo: string | null;
  presentedAt: number | null;
  pendingSince: number | null;
  paused: boolean;
  nextAdvanceAt: number | null;
};
export type RuntimeHealthSnapshot = { at: number; health: SlideshowRuntimeHealth };

export const isRuntimeHealth = (value: unknown): value is SlideshowRuntimeHealth => {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<SlideshowRuntimeHealth>;
  const timestamp = (field: unknown) =>
    field === null || (typeof field === "number" && Number.isFinite(field));
  return (
    (health.photo === null || typeof health.photo === "string") &&
    typeof health.paused === "boolean" &&
    timestamp(health.presentedAt) &&
    timestamp(health.pendingSince) &&
    timestamp(health.nextAdvanceAt)
  );
};

export const runtimeHealthFailure = (
  snapshot: RuntimeHealthSnapshot,
  now: number,
): string | null => {
  if (now - snapshot.at > RUNTIME_HEALTH_TIMEOUT_MS) return "heartbeat-timeout";
  const { health } = snapshot;
  if (health.paused) return null;
  if (health.pendingSince !== null && now - health.pendingSince > 60000) return "image-timeout";
  if (health.nextAdvanceAt !== null && now - health.nextAdvanceAt > RUNTIME_HEALTH_TIMEOUT_MS)
    return "advance-timeout";
  return null;
};
