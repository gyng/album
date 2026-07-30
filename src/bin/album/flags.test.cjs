/** @jest-environment node */

const { parseFlags, toKebabCase } = require("./flags.cjs");

const command = {
  name: "demo",
  flags: {
    profile: { type: "boolean", default: false, description: "Profile it" },
    out: { type: "string", default: null, description: "Output path", aliases: ["-o"] },
    jobs: { type: "number", default: 1, description: "Job count" },
    target: {
      type: "string",
      default: "vercel",
      description: "Deploy target",
      choices: ["vercel", "netlify"],
    },
  },
};

describe("toKebabCase", () => {
  it.each([
    ["profile", "profile"],
    ["skipBuild", "skip-build"],
    ["dryRunOnly", "dry-run-only"],
  ])("converts %s", (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });
});

describe("parseFlags", () => {
  it("applies declared defaults when nothing is passed", () => {
    expect(parseFlags(command, [])).toEqual({
      help: false,
      rest: [],
      profile: false,
      out: null,
      jobs: 1,
      target: "vercel",
    });
  });

  it("sets boolean flags without consuming a value", () => {
    expect(parseFlags(command, ["--profile"]).profile).toBe(true);
  });

  it("reads a value flag and its alias", () => {
    expect(parseFlags(command, ["--out", "dist"]).out).toBe("dist");
    expect(parseFlags(command, ["-o", "dist"]).out).toBe("dist");
  });

  it("coerces numeric flags", () => {
    expect(parseFlags(command, ["--jobs", "4"]).jobs).toBe(4);
  });

  it("accepts a value within the declared choices", () => {
    expect(parseFlags(command, ["--target", "netlify"]).target).toBe("netlify");
  });

  it("treats a command with no flag spec as having none", () => {
    expect(parseFlags({ name: "bare" }, [])).toEqual({ help: false, rest: [] });
  });

  it.each([["--help"], ["-h"]])("records %s without treating it as unknown", (token) => {
    expect(parseFlags(command, [token]).help).toBe(true);
  });

  it("forwards everything after -- verbatim", () => {
    expect(parseFlags(command, ["--profile", "--", "--match", "kanto"])).toMatchObject({
      profile: true,
      rest: ["--match", "kanto"],
    });
  });

  it.each([
    [["--wat"], "Unknown argument: --wat"],
    [["--out"], "Missing value for --out"],
    [["--out", ""], "Missing value for --out"],
    [["--target", "s3"], "Invalid value for --target: s3 (expected: vercel, netlify)"],
    [["stray"], "Unexpected argument: stray"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseFlags(command, argv)).toThrow(message);
  });
});

describe("parseFlags with a positional", () => {
  const positionalCommand = {
    name: "index",
    flags: {},
    positional: { name: "mode", default: "full", choices: ["full", "embeddings"] },
  };

  it("falls back to the declared default", () => {
    expect(parseFlags(positionalCommand, []).mode).toBe("full");
  });

  it("accepts a valid positional", () => {
    expect(parseFlags(positionalCommand, ["embeddings"]).mode).toBe("embeddings");
  });

  it("rejects an unknown positional", () => {
    expect(() => parseFlags(positionalCommand, ["nope"])).toThrow(
      "Invalid mode: nope (expected: full, embeddings)",
    );
  });

  it("rejects a second positional", () => {
    expect(() => parseFlags(positionalCommand, ["full", "extra"])).toThrow(
      "Unexpected argument: extra",
    );
  });

  it("accepts a positional with no choice list", () => {
    const freeform = { name: "x", flags: {}, positional: { name: "slug", default: "all" } };
    expect(parseFlags(freeform, ["kanto"]).slug).toBe("kanto");
  });
});
