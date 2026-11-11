import { matchTimelineMoment, withMoment } from "./clipTimelineMatch";

const timeline = JSON.stringify([
  { start: 0, end: 15, description: "A harbour at dusk with boats moored." },
  { start: 15, end: 30, description: "A ferry leaves the pier.", speech: "Look at the lanterns!" },
  { start: 30, end: 45, description: "Lanterns hang over a ferry at the pier." },
]);

describe("matchTimelineMoment", () => {
  it("finds the window the words are in, preferring the one with most of them", () => {
    expect(matchTimelineMoment(timeline, "harbour")).toEqual({
      start: 0,
      text: "A harbour at dusk with boats moored.",
    });
    expect(matchTimelineMoment(timeline, "ferry lanterns")?.start).toBe(30);
  });

  it("answers with the speech when the speech is what matched", () => {
    expect(matchTimelineMoment(timeline, "lanterns")).toEqual({
      start: 15,
      text: "Look at the lanterns!",
    });
  });

  it("is null without a match, a usable query or a readable timeline", () => {
    expect(matchTimelineMoment(timeline, "mountain")).toBeNull();
    expect(matchTimelineMoment(timeline, "a")).toBeNull();
    expect(matchTimelineMoment(null, "harbour")).toBeNull();
    expect(matchTimelineMoment("not json", "harbour")).toBeNull();
    expect(matchTimelineMoment('{"start":0}', "harbour")).toBeNull();
  });
});

describe("withMoment", () => {
  it("puts the moment before the anchor, and leaves other links alone", () => {
    expect(withMoment("/album/trip#clip.mov", 41.6)).toBe("/album/trip?t=42#clip.mov");
    expect(withMoment("/album/trip", 42)).toBe("/album/trip");
    expect(withMoment("/album/trip?t=9#clip.mov", 42)).toBe("/album/trip?t=9#clip.mov");
  });
});
