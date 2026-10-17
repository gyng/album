export const FUN_GAMES = [
  {
    id: "connections",
    href: "/fun/connections",
    title: "Connect the Shots",
    illustration: "/fun/connect-the-shots.avif",
    description: "Find the hidden connections in a grid of photographs.",
  },
  {
    id: "cross-exposure",
    href: "/fun/cross-exposure",
    title: "Cross Exposure",
    illustration: "/fun/cross-exposure.avif",
    description: "Every photograph has two connections. Find its place in the grid.",
  },
  {
    id: "guess",
    href: "/fun/guess",
    title: "Guess Where",
    illustration: "/fun/guess-where.avif",
    description: "Place a photograph on the map. How close can you get?",
  },
  {
    id: "oracle",
    href: "/fun/oracle",
    title: "Photo Oracle",
    illustration: "/fun/photo-oracle.avif",
    description:
      "Discover a photograph through visual questions, or challenge the oracle to find yours.",
  },
  {
    id: "blind-frame",
    href: "/fun/blind-frame",
    title: "Blind Frame",
    illustration: "/fun/blind-frame.avif",
    description: "Draw a hidden photograph from its description. How close will your sketch come?",
  },
  {
    id: "sight-lines",
    href: "/fun/sight-lines",
    title: "Sight Lines",
    illustration: "/fun/sight-lines.avif",
    description: "A word search with photographs. Find lines that share a subject.",
  },
  {
    id: "photo-pairs",
    href: "/fun/photo-pairs",
    title: "Photo Pairs",
    illustration: "/fun/photo-pairs.avif",
    description: "Remember the photographs. Find the pairs that belong together.",
  },
  {
    id: "warmer",
    href: "/fun/warmer",
    title: "Warmer",
    illustration: "/fun/warmer.avif",
    description: "Describe a hidden photograph. Each guess says how close you are.",
  },
  {
    id: "double-take",
    href: "/fun/double-take",
    title: "Double Take",
    illustration: "/fun/double-take.avif",
    description: "Two fleeting photographs. Same look. Same place?",
  },
  {
    id: "photo-jigsaw",
    href: "/fun/photo-jigsaw",
    title: "Photo Jigsaw",
    illustration: "/fun/photo-jigsaw.avif",
    description: "Piece an archive photograph back together, with a twist.",
  },
  {
    id: "wander",
    href: "/fun/wander",
    title: "Wander",
    illustration: "/fun/wander.avif",
    description:
      "Follow photographic trails, find hidden subjects, or wander without a destination.",
  },
  {
    id: "hindsight",
    href: "/fun/hindsight",
    title: "Hindsight",
    illustration: "/fun/hindsight.avif",
    description: "Put the photographs in the order they were taken.",
  },
  {
    id: "caption-it",
    href: "/fun/caption-it",
    title: "Caption It",
    illustration: "/fun/caption-it.avif",
    description: "Caption a photograph so well it stands out from the whole archive.",
  },
  {
    id: "photo-hangman",
    href: "/fun/photo-hangman",
    title: "Photo Hangman",
    illustration: "/fun/photo-hangman.avif",
    description:
      "Find the subject shared by eight photographs. Each wrong guess reveals another clue.",
  },
  {
    id: "relay",
    href: "/fun/relay",
    title: "Photo Relay",
    illustration: "/fun/photo-relay.avif",
    description:
      "Two photographs, five missing links. Find the smoothest visual route between them.",
  },
] as const;

export type PhotoGameKind =
  | "photo-pairs"
  | "photo-jigsaw"
  | "relay"
  | "blind-frame"
  | "oracle"
  | "connections"
  | "double-take"
  | "cross-exposure"
  | "sight-lines"
  | "photo-hangman"
  | "hindsight"
  | "warmer"
  | "caption-it";
export type FunPage = "fun" | "guess" | "wander" | PhotoGameKind;
