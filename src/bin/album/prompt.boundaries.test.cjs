/** @jest-environment node */

// askText is the only new I/O primitive in the CLI, so it gets a boundaries
// test against a fake readline interface, mirroring the technique in
// publish-wizard-lib.boundaries.test.cjs.

const readline = require("node:readline/promises");
const { MAX_ATTEMPTS, askText } = require("./prompt.cjs");

afterEach(() => {
  jest.restoreAllMocks();
});

const makeInterface = (responses) => {
  const close = jest.fn();
  const questions = [];

  return {
    close,
    questions,
    createInterface: () => ({
      question: async (prompt) => {
        questions.push(prompt);
        return responses.shift() ?? "";
      },
      close,
    }),
  };
};

describe("askText", () => {
  it("returns the typed answer, trimmed", async () => {
    const rl = makeInterface(["  Gallery  "]);
    await expect(
      askText({ prompt: "Site name", createInterface: rl.createInterface }),
    ).resolves.toBe("Gallery");
  });

  it("falls back to the default on an empty answer, and shows it in the prompt", async () => {
    const rl = makeInterface([""]);
    await expect(
      askText({
        prompt: "Site name",
        defaultValue: "Snapshots",
        createInterface: rl.createInterface,
      }),
    ).resolves.toBe("Snapshots");
    expect(rl.questions[0]).toBe("Site name [Snapshots]: ");
  });

  it("omits the bracket when there is no default", async () => {
    const rl = makeInterface(["x"]);
    await askText({ prompt: "Site name", createInterface: rl.createInterface });
    expect(rl.questions[0]).toBe("Site name: ");
  });

  it("re-prompts after a validation failure and reports why", async () => {
    const rl = makeInterface(["bad", "good"]);
    const log = jest.fn();

    const value = await askText({
      prompt: "URL",
      createInterface: rl.createInterface,
      log,
      validate: (input) => {
        if (input !== "good") {
          throw new Error("Not a valid URL");
        }
        return input;
      },
    });

    expect(value).toBe("good");
    expect(rl.questions).toHaveLength(2);
    expect(log.mock.calls.flat().join("\n")).toContain("Not a valid URL");
  });

  // An unbounded retry loop would hang forever against a piped stdin in CI.
  it("gives up after a bounded number of attempts", async () => {
    const rl = makeInterface([]);

    await expect(
      askText({
        prompt: "URL",
        createInterface: rl.createInterface,
        log: jest.fn(),
        validate: () => {
          throw new Error("nope");
        },
      }),
    ).rejects.toThrow(`No valid answer for "URL" after ${MAX_ATTEMPTS} attempts.`);

    expect(rl.questions).toHaveLength(MAX_ATTEMPTS);
  });

  it("reports a non-Error validation failure", async () => {
    const rl = makeInterface(["x"]);
    const log = jest.fn();

    await expect(
      askText({
        prompt: "URL",
        createInterface: rl.createInterface,
        log,
        validate: () => {
          throw "plain string";
        },
      }),
    ).rejects.toThrow("No valid answer");
    expect(log.mock.calls.flat().join("\n")).toContain("plain string");
  });

  // Exercises the production defaults: the real readline factory and console.log.
  it("uses node:readline and the console by default", async () => {
    const close = jest.fn();
    jest
      .spyOn(readline, "createInterface")
      .mockReturnValue({ question: async () => "typed", close });
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});

    await expect(askText({ prompt: "Site name" })).resolves.toBe("typed");
    expect(readline.createInterface).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("always closes the interface, including on failure", async () => {
    const rl = makeInterface(["x"]);
    await askText({ prompt: "Site name", createInterface: rl.createInterface });
    expect(rl.close).toHaveBeenCalled();

    const failing = makeInterface([]);
    await expect(
      askText({
        prompt: "URL",
        createInterface: failing.createInterface,
        log: jest.fn(),
        validate: () => {
          throw new Error("nope");
        },
      }),
    ).rejects.toThrow();
    expect(failing.close).toHaveBeenCalled();
  });
});
