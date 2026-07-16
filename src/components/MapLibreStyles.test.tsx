/**
 * @jest-environment jsdom
 */

import { render } from "@testing-library/react";
import { MapLibreStyles } from "./MapLibreStyles";

describe("MapLibreStyles", () => {
  it("adds the route-scoped MapLibre stylesheet to the document head", () => {
    render(<MapLibreStyles />);

    expect(document.head.querySelector('link[href="/vendor/maplibre-gl.css"]')).toHaveAttribute(
      "rel",
      "stylesheet",
    );
  });
});
