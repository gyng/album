// The one place symbolic step names map to shell commands.
//
// Commands shell out to `npm run` rather than requiring the sibling bin modules
// in-process. That is forced, not stylistic: `MALLOC_ARENA_MAX` is read by glibc
// when the allocator initialises and `VIPS_CONCURRENCY` by libvips at init, so
// neither can be set from inside an already-running Node process. Composing
// in-process would silently discard the memory tuning that the image pipeline
// needs in order not to OOM.
//
// A fork retargeting to a different package manager or pipeline edits this file
// and nothing else.

const STEPS = {
  dev: { command: "npm run dev", cwd: "srcDir" },
  build: { command: "npm run build", cwd: "srcDir" },
  buildProfile: { command: "npm run build:profile", cwd: "srcDir" },
  indexFull: { command: "npm run index:update", cwd: "srcDir" },
  indexEmbeddings: { command: "npm run index:embeddings:update", cwd: "srcDir" },
  indexRetag: { command: "npm run index:retag", cwd: "srcDir" },
};

module.exports = { STEPS };
