import { describeRelayLinks } from "./photoRelay";
import type { PhotoGamePhoto } from "./photoGames";
const photo = (caption: string, tags = ""): PhotoGamePhoto => ({
  path: caption,
  href: "/",
  caption,
  tags,
  vector: [1, 0],
});
it("explains each adjacent link with indexed concrete subjects and actual resemblance", () => {
  expect(
    describeRelayLinks([
      photo("A cat beside a window"),
      photo("A window with a cat"),
      photo("A mountain"),
    ]),
  ).toEqual([
    { from: 1, to: 2, similarity: 100, subjects: ["Cat", "Window"] },
    { from: 2, to: 3, similarity: 100, subjects: [] },
  ]);
});
it("uses tags but respects negated caption subjects and does not invent resemblance", () => {
  const missing = { ...photo("No cat in the room", "cat"), vector: [] };
  expect(describeRelayLinks([missing, photo("A cat")])[0]).toEqual({
    from: 1,
    to: 2,
    similarity: null,
    subjects: [],
  });
  expect(describeRelayLinks([photo("", "window"), photo("A window")])[0]?.subjects).toEqual([
    "Window",
  ]);
});
