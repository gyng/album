// Serve the published wllama esm directory at /wllama/ and the pinned GGUF at /ud-q4.gguf.
// Pass the local server URL and optional output JSON path. Never pass private credentials.
const { chromium } = require("../../src/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    p.on("console", (m) => {
      if (m.type() === "error") console.log("RUNTIME:", m.text().slice(0, 1200));
    });
    await p.goto(process.argv[2] || "http://127.0.0.1:43832/");
    const result = await p.evaluate(async () => {
      let runtime;
      try {
        const { Wllama } = await import("/wllama/index.js");
        runtime = new Wllama({ default: "/wllama/wasm/wllama.wasm" });
        const blob = await (await fetch("/ud-q4.gguf")).blob();
        const start = performance.now();
        await runtime.loadModel([blob], {
          embeddings: true,
          n_ctx: 512,
          n_threads: 1,
          n_gpu_layers: 0,
        });
        const result = await runtime.createEmbedding({
          input: "task: search result | query: a cat resting outdoors",
        });
        return { success: true, loadAndQueryMs: performance.now() - start, result };
      } catch (e) {
        return { success: false, error: String(e) };
      } finally {
        try {
          await runtime?.exit();
        } catch {}
      }
    });
    console.log(JSON.stringify(result));
    if (process.argv[3])
      require("fs").writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
