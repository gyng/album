const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const MAX_ATTEMPTS = 3;

/**
 * Free-text counterpart to askYesNo in publish-wizard-lib.cjs. Re-prompts on a
 * validation failure, but only a bounded number of times — an unbounded loop
 * would hang forever against a piped stdin in CI.
 */
const askText = async ({
  prompt,
  defaultValue = "",
  validate = (value) => value,
  createInterface = readline.createInterface,
  log = console.log,
}) => {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const raw = (await rl.question(`${prompt}${suffix}: `)).trim();
      const value = raw || defaultValue;

      try {
        return validate(value);
      } catch (err) {
        log(`  ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(`No valid answer for "${prompt}" after ${MAX_ATTEMPTS} attempts.`);
  } finally {
    rl.close();
  }
};

module.exports = { MAX_ATTEMPTS, askText };
