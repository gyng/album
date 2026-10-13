import { clusterVectors } from "./semanticClusters";
it("separates semantic differences that a three-axis projection could discard", () => {
  const vectors = [
    [1, 0, 0, 10],
    [1, 0, 0, 9],
    [1, 0, 0, -10],
    [1, 0, 0, -9],
  ];
  expect(clusterVectors(vectors, 2)).toEqual([
    [0, 1],
    [2, 3],
  ]);
});
it("handles empty inputs and retains every photograph exactly once", () => {
  expect(clusterVectors([], 8)).toEqual([]);
  const groups = clusterVectors(
    [
      [1, 0],
      [1, 0],
      [0, 1],
    ],
    8,
  );
  expect(groups.flat().sort((a, b) => a - b)).toEqual([0, 1, 2]);
});
