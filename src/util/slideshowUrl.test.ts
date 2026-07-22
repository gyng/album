import {
  applySlideshowUrlState,
  buildSlideshowPermalink,
  parseSlideshowSearchParams,
  SlideshowMode,
} from "./slideshowUrl";

describe("parseSlideshowSearchParams", () => {
  const parse = (search: string, fallback: SlideshowMode = "weighted") =>
    parseSlideshowSearchParams(search, fallback);

  it("returns null for every absent optional param (so callers leave state untouched)", () => {
    const p = parse("");
    expect(p.clock).toBeNull();
    expect(p.details).toBeNull();
    expect(p.map).toBeNull();
    expect(p.cover).toBeNull();
    expect(p.timeAware).toBeNull();
    expect(p.remix).toBeNull();
    expect(p.alignCadence).toBeNull();
    expect(p.alignment).toBeNull();
    expect(p.delayMs).toBeNull();
    expect(p.shuffleHistory).toBeNull();
    expect(p.filter).toBeNull();
    expect(p.mode).toBeNull();
    expect(p.initialPhotoPath).toBeNull();
    expect(p.randomSimilar).toBe(false);
  });

  it("parses boolean-like truthy values case-insensitively", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", "Yes", "ON"]) {
      expect(parse(`clock=${v}`).clock).toBe(true);
    }
  });

  it("treats any other boolean value as false (present but not truthy)", () => {
    expect(parse("clock=0").clock).toBe(false);
    expect(parse("clock=nope").clock).toBe(false);
    expect(parse("clock=").clock).toBe(false);
  });

  it("resolves nextMode from an explicit valid mode, else the fallback", () => {
    expect(parse("mode=similar").mode).toBe("similar");
    expect(parse("mode=similar").nextMode).toBe("similar");
    // explicit mode is null when absent/invalid, but nextMode falls back
    expect(parse("", "random").mode).toBeNull();
    expect(parse("", "random").nextMode).toBe("random");
    expect(parse("mode=bogus", "random").mode).toBeNull();
    expect(parse("mode=bogus", "random").nextMode).toBe("random");
  });

  it("gates randomSimilar on the RESOLVED mode being similar", () => {
    expect(parse("mode=similar&random=1").randomSimilar).toBe(true);
    expect(parse("random=1", "similar").randomSimilar).toBe(true); // fallback similar
    expect(parse("mode=random&random=1").randomSimilar).toBe(false);
    expect(parse("mode=similar&random=0").randomSimilar).toBe(false);
    expect(parse("mode=similar").randomSimilar).toBe(false);
  });

  it("gates shuffleHistory on resolved similar mode and a positive value", () => {
    expect(parse("mode=similar&shuffle=50").shuffleHistory).toBe(50);
    expect(parse("shuffle=50", "similar").shuffleHistory).toBe(50);
    expect(parse("mode=random&shuffle=50").shuffleHistory).toBeNull();
    expect(parse("mode=similar&shuffle=0").shuffleHistory).toBeNull();
    expect(parse("mode=similar&shuffle=-5").shuffleHistory).toBeNull();
  });

  it("converts delay seconds to ms, rejecting zero and negative", () => {
    expect(parse("delay=60").delayMs).toBe(60000);
    expect(parse("delay=0").delayMs).toBeNull();
    expect(parse("delay=-30").delayMs).toBeNull();
    expect(parse("delay=abc").delayMs).toBeNull();
  });

  it("prefers photo over seed, falling back to seed", () => {
    expect(parse("photo=a/b.jpg&seed=c/d.jpg").initialPhotoPath).toBe("a/b.jpg");
    expect(parse("seed=c/d.jpg").initialPhotoPath).toBe("c/d.jpg");
    expect(parse("").initialPhotoPath).toBeNull();
  });

  it("only accepts left/center/right alignment", () => {
    expect(parse("align=left").alignment).toBe("left");
    expect(parse("align=right").alignment).toBe("right");
    expect(parse("align=middle").alignment).toBeNull();
  });

  it("treats an empty filter as null", () => {
    expect(parse("filter=japan").filter).toBe("japan");
    expect(parse("filter=").filter).toBeNull();
  });

  it("parses a trimmed topic, treating blank as null", () => {
    expect(parse("topic=cat").topic).toBe("cat");
    expect(parse("topic=%20cat%20").topic).toBe("cat");
    expect(parse("topic=").topic).toBeNull();
    expect(parse("topic=%20%20").topic).toBeNull();
    expect(parse("").topic).toBeNull();
  });
});

describe("applySlideshowUrlState", () => {
  it("sets mode, writes delay as SECONDS, deletes photo and seed, preserves other params", () => {
    const out = applySlideshowUrlState(
      "https://x.test/slideshow?filter=japan&photo=a/b.jpg&seed=c/d.jpg&clock=1",
      { mode: "random", delayMs: 60000 },
    );
    const u = new URL(out);
    expect(u.searchParams.get("mode")).toBe("random");
    expect(u.searchParams.get("delay")).toBe("60"); // seconds, not ms
    expect(u.searchParams.get("photo")).toBeNull();
    expect(u.searchParams.get("seed")).toBeNull();
    expect(u.searchParams.get("filter")).toBe("japan"); // preserved
    expect(u.searchParams.get("clock")).toBe("1"); // preserved
  });

  it("preserves an existing topic param when topic is omitted", () => {
    const out = applySlideshowUrlState("https://x.test/slideshow?topic=cat", {
      mode: "similar",
      delayMs: 30000,
    });
    expect(new URL(out).searchParams.get("topic")).toBe("cat");
  });

  it("sets the topic param when a topic string is given", () => {
    const out = applySlideshowUrlState("https://x.test/slideshow", {
      mode: "similar",
      delayMs: 30000,
      topic: "dog",
    });
    expect(new URL(out).searchParams.get("topic")).toBe("dog");
  });

  it("deletes the topic param when topic is null (dismiss)", () => {
    const out = applySlideshowUrlState("https://x.test/slideshow?topic=cat", {
      mode: "weighted",
      delayMs: 30000,
      topic: null,
    });
    expect(new URL(out).searchParams.has("topic")).toBe(false);
  });
});

describe("buildSlideshowPermalink", () => {
  it("builds a fresh /slideshow link with mode, filter and photo (no delay)", () => {
    const out = buildSlideshowPermalink({
      origin: "https://x.test",
      mode: "similar",
      photoPath: "../albums/japan/IMG_1.jpg",
      filter: "japan",
    });
    const u = new URL(out);
    expect(u.pathname).toBe("/slideshow");
    expect(u.searchParams.get("mode")).toBe("similar");
    expect(u.searchParams.get("filter")).toBe("japan");
    expect(u.searchParams.get("photo")).toBe("../albums/japan/IMG_1.jpg");
    expect(u.searchParams.get("delay")).toBeNull();
  });

  it("omits the filter param when no filter is given", () => {
    const out = buildSlideshowPermalink({
      origin: "https://x.test",
      mode: "random",
      photoPath: "a/b.jpg",
    });
    expect(new URL(out).searchParams.has("filter")).toBe(false);
  });

  it("includes the topic param when a topic is active, and omits it otherwise", () => {
    const withTopic = buildSlideshowPermalink({
      origin: "https://x.test",
      mode: "similar",
      photoPath: "../albums/japan/IMG_1.jpg",
      topic: "cat",
    });
    expect(new URL(withTopic).searchParams.get("topic")).toBe("cat");

    const withoutTopic = buildSlideshowPermalink({
      origin: "https://x.test",
      mode: "similar",
      photoPath: "../albums/japan/IMG_1.jpg",
    });
    expect(new URL(withoutTopic).searchParams.has("topic")).toBe(false);
  });
});
