export const FUN_GAMES = [
  {
    id: "guess",
    href: "/fun/guess",
    title: "Guess Where",
    illustration: "/fun/guess-where.avif",
    description: "Place a photograph on the map. How close can you get?",
  },
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
    id: "relay",
    href: "/fun/relay",
    title: "Photo Relay",
    illustration: "/fun/photo-relay.avif",
    description:
      "Two photographs, five missing links. Find the smoothest visual route between them.",
  },
  {
    id: "blind-frame",
    href: "/fun/blind-frame",
    title: "Blind Frame",
    illustration: "/fun/blind-frame.avif",
    description:
      "A hidden photograph, described in words. Sketch it, then discover what the archive sees.",
  },
  {
    id: "oracle",
    href: "/fun/oracle",
    title: "Photo Oracle",
    illustration: "/fun/photo-oracle.avif",
    description: "Keep a photograph in mind. Can the oracle find it with yes-or-no questions?",
  },
  {
    id: "double-take",
    href: "/fun/double-take",
    title: "Double Take",
    illustration: "/fun/double-take.avif",
    description: "Two fleeting photographs. Same look. Same place?",
  },
] as const;

export type PhotoGameKind =
  | "relay"
  | "blind-frame"
  | "oracle"
  | "connections"
  | "double-take"
  | "cross-exposure";
export type FunPage = "fun" | "guess" | PhotoGameKind;
