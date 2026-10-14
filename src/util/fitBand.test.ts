import { fitBand } from "./fitBand";

it("names a 0–100 fit in a word or two, from best to worst", () => {
  const bands = [100, 95, 85, 65, 40, 20, 0].map(fitBand);
  expect(bands[0]).toBe(bands[1]);
  expect(new Set(bands.slice(1)).size).toBe(bands.length - 1);
  expect(fitBand(95)).not.toBe(fitBand(94));
});
