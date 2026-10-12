export const FUN_GAMES = [
  {
    id: "guess",
    href: "/fun/guess",
    title: "Guess Where",
    illustration: "/fun/guess-where.avif",
    description: "Place a photograph on the map. How close can you get?",
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
    id: "connections",
    href: "/fun/connections",
    title: "Connect the Shots",
    illustration: "/fun/connect-the-shots.avif",
    description: "Sixteen photographs. Four hidden connections. Find the groups of four.",
  },
] as const;

export type PhotoGameKind = "relay" | "blind-frame" | "oracle" | "connections";
export type FunPage = "fun" | "guess" | PhotoGameKind;
