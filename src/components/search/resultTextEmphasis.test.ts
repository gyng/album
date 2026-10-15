import { resultTextOpacities } from "./resultTextEmphasis";

it("keeps the strongest semantic matches clear and gently fades weaker ones", () => {
  const opacity = resultTextOpacities([
    { similarity: 0.9 },
    { similarity: 0.87 },
    { similarity: 0.8 },
    { similarity: 0.6 },
  ]);
  expect(opacity[0]).toBe(1);
  expect(opacity[1]).toBe(1);
  expect(opacity[2]).toBeLessThan(1);
  expect(opacity[2]).toBeGreaterThan(opacity[3]!);
  expect(opacity[3]).toBeCloseTo(0.72);
});

it("uses the fused hybrid score rather than penalising a strong keyword match", () => {
  const opacity = resultTextOpacities([
    { rrfScore: 0.032, similarity: 0.3 },
    { rrfScore: 0.016, similarity: 0.9 },
  ]);
  expect(opacity[0]).toBe(1);
  expect(opacity[1]).toBeCloseTo(0.72);
});

it("handles colour percentages without comparing them to cosine scores", () => {
  expect(resultTextOpacities([{ colorMatchScore: 100 }, { colorMatchScore: 70 }])).toEqual([
    1, 0.72,
  ]);
});

it("leaves unscored, invalid and tied results at full strength", () => {
  expect(resultTextOpacities([{}, { similarity: Number.NaN }, { rrfScore: 0 }])).toEqual([1, 1, 1]);
  expect(resultTextOpacities([{ similarity: 0.5 }, { similarity: 0.5 }])).toEqual([1, 1]);
});
