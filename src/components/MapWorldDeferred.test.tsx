/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { PlatformProvider } from "./platform";
import { createPlatformAdapter } from "../test/platformTestAdapter";

import { MapWorldDeferred } from "./MapWorldDeferred";

describe("MapWorldDeferred", () => {
  it("passes world-map props to the renderer-provided client component", () => {
    const adapter = createPlatformAdapter({
      clientComponents: {
        MapWorld: (props) => (
          <div data-testid="deferred-world-map">
            {props.className}:{props.photos.length}
          </div>
        ),
      },
    });
    render(
      <PlatformProvider value={adapter}>
        <MapWorldDeferred className="atlas" photos={[]} />
      </PlatformProvider>,
    );
    expect(screen.getByTestId("deferred-world-map")).toHaveTextContent("atlas:0");
  });
});
