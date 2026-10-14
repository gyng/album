// Read top down: the first floor a score reaches names it.
const BANDS: Array<[number, string]> = [
  [95, "Perfect"],
  [80, "Close enough"],
  [60, "Getting there"],
  [35, "Loose"],
  [15, "A stretch"],
];

/** A word for a 0–100 fit or resemblance, so the number is not left to speak for itself. */
export const fitBand = (score: number): string =>
  BANDS.find(([floor]) => score >= floor)?.[1] ?? "Way off";
