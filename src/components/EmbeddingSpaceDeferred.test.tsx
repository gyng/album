/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { PlatformProvider } from "./platform";
import type { ClientComponents } from "./platform";
import { createPlatformAdapter } from "../test/platformTestAdapter";

import { EmbeddingSpaceDeferred } from "./EmbeddingSpaceDeferred";

describe("EmbeddingSpaceDeferred", () => {
  it("passes cloud props to the renderer-provided client component", () => {
    const adapter = createPlatformAdapter({
      clientComponents: {
        EmbeddingSpace: ({ className, height }) => (
          <div data-testid="deferred-cloud">
            {className}:{height}
          </div>
        ),
      } as ClientComponents,
    });
    render(
      <PlatformProvider value={adapter}>
        <EmbeddingSpaceDeferred className="cloud" height={500} />
      </PlatformProvider>,
    );
    expect(screen.getByTestId("deferred-cloud")).toHaveTextContent("cloud:500");
  });
});
