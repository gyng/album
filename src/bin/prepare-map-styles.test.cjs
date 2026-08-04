const { applyOrigin } = require("./prepare-map-styles.cjs");

describe("applyOrigin", () => {
  // MapLibre rejects a relative sprite URL outright, so the origin has to be
  // in the document — and it differs between a laptop, a preview and
  // production, which is why it cannot be committed.
  it("fills the origin into every place the template asks for one", () => {
    const filled = applyOrigin(
      '{"sprite":"{{origin}}/map-styles/gallery/sprite","x":"{{origin}}/y"}',
      "https://example.test",
    );

    expect(filled).toBe(
      '{"sprite":"https://example.test/map-styles/gallery/sprite","x":"https://example.test/y"}',
    );
    expect(filled).not.toContain("{{origin}}");
  });

  it("leaves a document with no token alone", () => {
    expect(applyOrigin('{"sprite":"https://cdn.test/sprite"}', "https://example.test")).toBe(
      '{"sprite":"https://cdn.test/sprite"}',
    );
  });
});
