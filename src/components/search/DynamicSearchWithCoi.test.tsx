/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { PlatformProvider } from "../platform";
import { createPlatformAdapter } from "../../test/platformTestAdapter";

import DynamicSearchWithCoi from "./DynamicSearchWithCoi";

describe("DynamicSearchWithCoi", () => {
  it("renders the renderer-provided isolated search boundary", () => {
    const adapter = createPlatformAdapter({
      clientComponents: {
        SearchWithCoi: () => <div data-testid="dynamic-search" />,
      },
    });
    render(
      <PlatformProvider value={adapter}>
        <DynamicSearchWithCoi />
      </PlatformProvider>,
    );
    expect(screen.getByTestId("dynamic-search")).toBeInTheDocument();
  });
});
