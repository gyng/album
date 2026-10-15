/** Give input and painting a turn between batches of synchronous database work. */
export const yieldToBrowser = (): Promise<void> => {
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};
