const {
  HISTORY_DISCLOSURE,
  NEXT_STEPS,
  SOCIAL_LABELS,
  buildConfig,
  buildDefaultConfig,
  buildSocialLinks,
  serialiseConfig,
  summariseConfig,
  validateOrigin,
  validateRequiredText,
} = require("../config.cjs");

const collectAnswers = async ({ args, base, services }) => {
  if (args.yes) {
    return {
      name: validateRequiredText(args.name ?? base.site.name, "Site name"),
      description: args.description ?? base.site.description,
      origin: validateOrigin(args.url),
      albumsDir: args.albumsDir ?? base.paths.albumsDir,
      social: base.social,
    };
  }

  const name = await services.askText({
    prompt: "Site name",
    defaultValue: base.site.name,
    validate: (value) => validateRequiredText(value, "Site name"),
  });

  const description = await services.askText({
    prompt: "Description",
    defaultValue: base.site.description,
  });

  const origin = await services.askText({
    prompt: "Public site URL",
    defaultValue: base.site.origin,
    validate: validateOrigin,
  });

  const albumsDir = await services.askText({
    prompt: "Albums directory",
    defaultValue: base.paths.albumsDir,
  });

  const hrefs = [];
  for (const label of SOCIAL_LABELS) {
    hrefs.push(
      await services.askText({
        prompt: `${label} URL (blank to omit)`,
        defaultValue: base.social.find((link) => link.label === label)?.href ?? "",
      }),
    );
  }

  return { name, description, origin, albumsDir, social: buildSocialLinks(hrefs) };
};

module.exports = {
  name: "init",
  aliases: [],
  summary: "Configure this gallery's identity",
  usage: "album init [options]",
  flags: {
    yes: { type: "boolean", default: false, description: "Accept defaults without prompting" },
    force: { type: "boolean", default: false, description: "Overwrite without confirming" },
    name: { type: "string", default: null, description: "Site name" },
    description: { type: "string", default: null, description: "Site description" },
    url: { type: "string", default: null, description: "Public site URL" },
    albumsDir: { type: "string", default: null, description: "Albums directory" },
  },
  positional: null,
  run: async ({ args, context, services, log, error, setExitCode }) => {
    // There is no safe default for the origin: a placeholder silently poisons
    // canonical URLs, feeds and the sitemap, and nobody reads their own
    // canonical tags.
    if (args.yes && !args.url) {
      error("--url is required with --yes.");
      setExitCode(1);
      return;
    }

    const existing = services.readJsonFile(context.configPath);
    const base = existing ?? buildDefaultConfig();

    if (existing && !args.force && !args.yes) {
      log("\nCurrent configuration:");
      for (const line of summariseConfig(existing)) {
        log(line);
      }

      const proceed = await services.askYesNo({
        prompt: "\nReconfigure this site?",
        defaultValue: false,
      });
      if (!proceed) {
        log("Left unchanged.");
        return;
      }
    }

    let answers;
    try {
      answers = await collectAnswers({ args, base, services });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      setExitCode(1);
      return;
    }

    const config = buildConfig({ base, answers });

    log("\nWriting configuration:");
    for (const line of summariseConfig(config)) {
      log(line);
    }

    services.writeFile(context.configPath, serialiseConfig(config));
    log(`\nWrote ${context.configPath}`);

    for (const line of [...HISTORY_DISCLOSURE, ...NEXT_STEPS]) {
      log(line);
    }
  },
};
