import { fireConfetti } from "./confetti";

describe("fireConfetti outside a browser", () => {
  it("is a no-op during server rendering", () => {
    expect(() => fireConfetti()).not.toThrow();
  });
});
