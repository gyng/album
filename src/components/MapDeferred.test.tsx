/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { PlatformProvider } from "./platform";
import { createPlatformAdapter } from "../test/platformTestAdapter";

import { MapDeferred } from "./MapDeferred";

describe("MapDeferred", () => {
  it("passes map props to the renderer-provided client component", () => {
    const adapter = createPlatformAdapter({
      clientComponents: {
        Map: ({ coordinates }) => <div data-testid="deferred-map">{coordinates.join(",")}</div>,
      },
    });
    render(
      <PlatformProvider value={adapter}>
        <MapDeferred coordinates={[1.25, 103.75]} />
      </PlatformProvider>,
    );
    expect(screen.getByTestId("deferred-map")).toHaveTextContent("1.25,103.75");
  });
});
