/** @jest-environment node */

const init = require("./init.cjs");
const { buildDefaultConfig } = require("../config.cjs");

const context = { configPath: "/src/site.config.json" };

const existingConfig = {
  ...buildDefaultConfig(),
  site: {
    ...buildDefaultConfig().site,
    name: "Snapshots",
    description: "Snapshots from a better era",
    origin: "https://photos.example",
  },
  social: [{ label: "Fediverse", href: "https://mastodon.example/@f" }],
};

const makeHarness = ({ existing = null, answers = [], confirm = true } = {}) => {
  const queue = [...answers];

  const services = {
    readJsonFile: jest.fn(() => existing),
    writeFile: jest.fn(),
    askYesNo: jest.fn(async () => confirm),
    // Mirrors the real askText: falls back to the prompt's default, and runs
    // the caller's validator so a bad answer still throws here.
    askText: jest.fn(async ({ defaultValue, validate = (value) => value }) =>
      validate(queue.length > 0 ? queue.shift() : defaultValue),
    ),
  };

  return { services, log: jest.fn(), error: jest.fn(), setExitCode: jest.fn() };
};

const run = async (args, harness) =>
  init.run({
    args: {
      yes: false,
      force: false,
      name: null,
      description: null,
      url: null,
      albumsDir: null,
      ...args,
    },
    context,
    services: harness.services,
    log: harness.log,
    error: harness.error,
    setExitCode: harness.setExitCode,
  });

const written = (harness) => JSON.parse(harness.services.writeFile.mock.calls[0][1]);

describe("album init", () => {
  it("writes a configuration from interactive answers", async () => {
    const harness = makeHarness({
      answers: [
        "Test Gallery",
        "A test gallery",
        "https://example.test",
        "../photos",
        "https://github.test/me",
        "",
        "",
      ],
    });
    await run({}, harness);

    expect(harness.services.writeFile).toHaveBeenCalledWith(
      "/src/site.config.json",
      expect.any(String),
    );
    expect(written(harness).site).toMatchObject({
      name: "Test Gallery",
      shortName: "Test Gallery",
      origin: "https://example.test",
    });
    expect(written(harness).social).toEqual([{ label: "GitHub", href: "https://github.test/me" }]);
  });

  it("normalises a bare hostname into an absolute origin", async () => {
    const harness = makeHarness({
      answers: ["G", "d", "example.test/", "../albums", "", "", ""],
    });
    await run({}, harness);

    expect(written(harness).site.origin).toBe("https://example.test");
  });

  it("seeds every prompt from the existing configuration", async () => {
    const harness = makeHarness({ existing: existingConfig });
    await run({}, harness);

    // Every answer falls through to the default, so the file is unchanged.
    expect(written(harness).site.name).toBe("Snapshots");
    expect(written(harness).site.origin).toBe("https://photos.example");
    expect(written(harness).social).toEqual(existingConfig.social);
  });

  it("asks before overwriting an existing configuration, and honours a refusal", async () => {
    const harness = makeHarness({ existing: existingConfig, confirm: false });
    await run({}, harness);

    expect(harness.services.askYesNo).toHaveBeenCalled();
    expect(harness.services.writeFile).not.toHaveBeenCalled();
    expect(harness.log.mock.calls.flat().join("\n")).toContain("Left unchanged.");
  });

  it("skips the confirmation when forced", async () => {
    const harness = makeHarness({ existing: existingConfig, confirm: false });
    await run({ force: true }, harness);

    expect(harness.services.askYesNo).not.toHaveBeenCalled();
    expect(harness.services.writeFile).toHaveBeenCalled();
  });

  it("starts from a credential-free template when no configuration exists", async () => {
    const harness = makeHarness({
      answers: ["G", "d", "https://e.test", "../albums", "", "", ""],
    });
    await run({}, harness);

    expect(written(harness).map.apiKey).toBe("");
    expect(written(harness).map.galleryStyleId).toBeNull();
  });

  describe("non-interactive", () => {
    it("requires a URL, because a placeholder origin silently breaks feeds", async () => {
      const harness = makeHarness();
      await run({ yes: true }, harness);

      expect(harness.error.mock.calls.flat().join("\n")).toContain("--url is required");
      expect(harness.setExitCode).toHaveBeenCalledWith(1);
      expect(harness.services.writeFile).not.toHaveBeenCalled();
    });

    it("writes without prompting when given a URL", async () => {
      const harness = makeHarness();
      await run({ yes: true, url: "https://example.test", name: "Flag Gallery" }, harness);

      expect(harness.services.askText).not.toHaveBeenCalled();
      expect(harness.services.askYesNo).not.toHaveBeenCalled();
      expect(written(harness).site.name).toBe("Flag Gallery");
      expect(written(harness).site.origin).toBe("https://example.test");
    });

    it("takes remaining values from the existing configuration", async () => {
      const harness = makeHarness({ existing: existingConfig });
      await run({ yes: true, url: "https://moved.test" }, harness);

      expect(written(harness).site.name).toBe("Snapshots");
      expect(written(harness).paths.albumsDir).toBe(existingConfig.paths.albumsDir);
    });

    it("reports an invalid URL and exits non-zero", async () => {
      const harness = makeHarness();
      await run({ yes: true, url: "not a url" }, harness);

      expect(harness.error.mock.calls.flat().join("\n")).toContain("Not a valid URL");
      expect(harness.setExitCode).toHaveBeenCalledWith(1);
      expect(harness.services.writeFile).not.toHaveBeenCalled();
    });

    it("accepts explicit description and albums directory flags", async () => {
      const harness = makeHarness();
      await run(
        {
          yes: true,
          url: "https://e.test",
          description: "Flagged description",
          albumsDir: "../pics",
        },
        harness,
      );

      expect(written(harness).site.description).toBe("Flagged description");
      expect(written(harness).paths.albumsDir).toBe("../pics");
    });
  });

  it("reports a non-Error failure raised while collecting answers", async () => {
    const harness = makeHarness();
    harness.services.askText = jest.fn(async () => {
      throw "string failure";
    });
    await run({}, harness);

    expect(harness.error.mock.calls.flat().join("\n")).toContain("string failure");
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.services.writeFile).not.toHaveBeenCalled();
  });

  it("discloses that git history still carries the original author's photos", async () => {
    const harness = makeHarness();
    await run({ yes: true, url: "https://e.test" }, harness);

    const printed = harness.log.mock.calls.flat().join("\n");
    expect(printed).toContain("git history");
    expect(printed).toContain("Next steps:");
  });
});
