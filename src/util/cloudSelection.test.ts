import { selectCloudIndices } from "./cloudSelection";
import type { EmbeddingSpaceEntry } from "./embeddingSpaceData";
const entries = [2024, 2023, 2024].map((year, index) => ({
  src: `/data/albums/a/.resized_images/${index}.jpg%40800.avif`,
  href: `/${index}`,
  label: String(index),
  x: index,
  y: 0,
  z: 0,
  year,
  lens: index === 1 ? "Zoom" : "Prime",
}));
it("combines year and lens without re-indexing the cloud", () => {
  expect([...selectCloudIndices(entries, "2024", "Prime", null)]).toEqual([0, 2]);
  expect([...selectCloudIndices(entries, "2023", "Prime", null)]).toEqual([]);
});
it("limits closest matches after applying filters and ignores missing archive paths", () => {
  const paths = [
    "../albums/a/1.jpg",
    "../albums/missing.jpg",
    "../albums/a/2.jpg",
    "../albums/a/0.jpg",
  ];
  expect([...selectCloudIndices(entries, "2024", "", paths, 1)]).toEqual([2]);
  expect([...selectCloudIndices(entries as EmbeddingSpaceEntry[], "", "", [])]).toEqual([]);
});
