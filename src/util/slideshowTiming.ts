const DAY_MS = 24 * 60 * 60 * 1000;

const getLocalDayStart = (date: Date): Date =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );

export const getNextAlignedSlideshowChange = ({
  now,
  delayMs,
}: {
  now: Date;
  delayMs: number;
}): Date => {
  if (delayMs >= DAY_MS) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0,
    );
  }

  const dayStart = getLocalDayStart(now);
  const elapsedMs = now.getTime() - dayStart.getTime();
  const nextStep = Math.floor(elapsedMs / delayMs) + 1;
  return new Date(dayStart.getTime() + nextStep * delayMs);
};
