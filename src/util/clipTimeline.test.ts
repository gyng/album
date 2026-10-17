import { parseClipTimeline } from "./clipTimeline";

describe("parseClipTimeline", () => {
  it("reads a timeline the indexer wrote", () => {
    expect(
      parseClipTimeline(
        JSON.stringify([
          { start: 0, end: 15, description: "A crossing at night." },
          { start: 15, end: 30, description: "A bus pulls in.", speech: "Mind the gap." },
        ]),
      ),
    ).toEqual([
      { start: 0, end: 15, description: "A crossing at night." },
      { start: 15, end: 30, description: "A bus pulls in.", speech: "Mind the gap." },
    ]);
  });

  // It travels into page props, so whatever the database held is checked: a
  // segment without a usable time cannot be linked to, and is dropped.
  it("keeps only segments with a usable time and something to say", () => {
    expect(
      parseClipTimeline(
        JSON.stringify([
          { start: "soon", end: 15, description: "No time." },
          { start: 0, end: 15 },
          { start: 15, end: 30, description: 7, speech: "Only speech." },
          null,
        ]),
      ),
    ).toEqual([{ start: 15, end: 30, speech: "Only speech." }]);
  });

  it("reads nothing from nothing", () => {
    expect(parseClipTimeline(null)).toBeUndefined();
    expect(parseClipTimeline("not json")).toBeUndefined();
    expect(parseClipTimeline("{}")).toBeUndefined();
    expect(parseClipTimeline("[]")).toBeUndefined();
  });
});
