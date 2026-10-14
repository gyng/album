import {
  bannedWordProblem,
  bannedWordsFor,
  captionBudgetProblem,
  dealCaptionSet,
  dealLookalikes,
  scoreCaptionSet,
  separation,
} from "./captionModes";
import type { PhotoGamePhoto } from "./photoGames";

const photo = (path: string, vector: number[], tags = ""): PhotoGamePhoto => ({
  path,
  href: `/album/${path}`,
  caption: `Caption for ${path}`,
  tags,
  vector,
});
// A unit vector `angle` degrees from the first axis, in a plane picked by `plane`.
const at = (angle: number, plane = 1, size = 6): number[] => {
  const v = Array.from({ length: size }, () => 0);
  v[0] = Math.cos((angle * Math.PI) / 180);
  v[plane] = Math.sin((angle * Math.PI) / 180);
  return v;
};
const axis = (index: number, size = 8): number[] =>
  Array.from({ length: size }, (_, i) => (i === index ? 1 : 0));
const fixed = () => 0;

describe("captionBudgetProblem", () => {
  it("counts words, not characters", () => {
    expect(captionBudgetProblem("a red tram-stop at dusk", 5)).toBeNull();
    expect(captionBudgetProblem("a red tram stop at dusk", 5)).toBe("Use 5 words at most.");
    expect(captionBudgetProblem("any number of words at all, really", null)).toBeNull();
  });
});

describe("banned words", () => {
  const archive = [
    photo("a/1.jpg", at(0), "bridge, river, dusk, red_lantern"),
    photo("a/2.jpg", at(10), "river, street"),
    photo("a/3.jpg", at(20), "river, dusk, street"),
  ];

  it("bans the rarest words in a photograph's tags", () => {
    expect(bannedWordsFor([archive[0]!], archive)).toEqual(["bridge", "lantern", "red"]);
  });

  it("bans the words a set shares before its rarest", () => {
    expect(bannedWordsFor([archive[1]!, archive[2]!], archive, 2)).toEqual(["street", "river"]);
  });

  it("refuses a banned word in either number", () => {
    expect(bannedWordProblem("Two bridges over water", ["bridge"])).toBe(
      "“bridges” is one of the banned words.",
    );
    expect(bannedWordProblem("A footbridge over water", ["bridge"])).toBeNull();
    expect(bannedWordProblem("Lantern-lit lane", ["lantern"])).not.toBeNull();
  });
});

describe("lookalikes", () => {
  const target = photo("a/target.jpg", at(0));
  const archive = [
    target,
    photo("a/burst.jpg", at(5)), // cos 0.996: a frame of the same burst
    photo("a/near1.jpg", at(25, 1)),
    photo("a/near2.jpg", at(25, 2)),
    photo("a/near3.jpg", at(25, 3)),
    photo("a/far.jpg", at(80, 4)),
  ];

  it("deals neighbours that are alike but not burst frames", () => {
    const deal = dealLookalikes([target], archive, fixed);
    expect(deal?.photo).toBe(target);
    expect(deal?.lookalikes.map((p) => p.path).sort()).toEqual([
      "a/near1.jpg",
      "a/near2.jpg",
      "a/near3.jpg",
    ]);
  });

  it("deals nothing when a photograph has too few lookalikes", () => {
    expect(dealLookalikes([target], archive.slice(0, 4), fixed)).toBeNull();
  });

  it("counts the lookalikes the caption fits less well than the photograph", () => {
    const deal = dealLookalikes([target], archive, fixed)!;
    expect(separation(at(0), deal)).toEqual({ ahead: 3, behind: [] });
    expect(separation(at(40, 1), deal)).toMatchObject({ ahead: 2, behind: ["a/near1.jpg"] });
  });
});

describe("caption sets", () => {
  const album = (name: string, count: number, alike: boolean) =>
    Array.from({ length: count }, (_, i) =>
      photo(`../albums/${name}/${i}.jpg`, alike ? at(i, 1, 8) : axis(i + 1)),
    );

  it("deals three different photographs from one album", () => {
    const set = dealCaptionSet([...album("burst", 5, true), ...album("trip", 4, false)], fixed);
    expect(set).toHaveLength(3);
    expect(new Set(set!.map((p) => p.path.split("/")[2]))).toEqual(new Set(["trip"]));
  });

  it("wins only when every photograph ranks near the top", () => {
    const set = album("trip", 3, false);
    const archive = [...set, ...Array.from({ length: 57 }, (_, i) => photo(`x/${i}`, axis(4)))];
    const all = scoreCaptionSet([0, 1, 1, 1, 0, 0, 0, 0], set, archive)!;
    expect(all).toMatchObject({ found: 3, won: true });
    // Fits the first well and the archive's other photographs better than the rest.
    const one = scoreCaptionSet([0, 1, 0, 0, 0.5, 0, 0, 0], set, archive)!;
    expect(one.found).toBe(1);
    expect(one.won).toBe(false);
  });
});
