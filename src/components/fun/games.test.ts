import { FUN_GAMES } from "./games";

// The order the cards and the subnav list the games in, which is the owner's
// choice of what to put first.
it("lists the games in the chosen order", () => {
  expect(FUN_GAMES.map((game) => game.id).slice(0, 10)).toEqual([
    "connections",
    "cross-exposure",
    "guess",
    "oracle",
    "blind-frame",
    "sight-lines",
    "photo-pairs",
    "warmer",
    "double-take",
    "photo-jigsaw",
  ]);
});
