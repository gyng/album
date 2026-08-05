const net = require("node:net");
const { pickFreePort } = require("./pickFreePort.cjs");

describe("pickFreePort", () => {
  it("keeps the preferred port when nothing holds it", () => {
    expect(pickFreePort(43110, () => "43110")).toBe(43110);
  });

  it("moves off a port something else is holding", () => {
    expect(pickFreePort(43110, () => "51234")).toBe(51234);
  });

  // A suite that cannot probe should still try its preferred port rather than
  // refuse to run: the probe exists to avoid a stoppage, not to cause one.
  it("falls back to the preferred port when the probe itself fails", () => {
    expect(
      pickFreePort(43110, () => {
        throw new Error("no child processes");
      }),
    ).toBe(43110);
    expect(pickFreePort(43110, () => "not a port")).toBe(43110);
  });

  // The real probe, against a port this test is holding open: the whole point is
  // that a taken port yields a different one.
  it("really avoids a port that is really taken", async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, resolve));
    const taken = server.address().port;

    try {
      const chosen = pickFreePort(taken);
      expect(chosen).not.toBe(taken);
      expect(chosen).toBeGreaterThan(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
