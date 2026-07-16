/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import FourOhFour from "../screens/FourOhFourScreen";

jest.mock("../components/GlobalNav", () => ({
  GlobalNav: () => <nav aria-label="Global navigation" />,
}));

jest.mock("../components/Seo", () => ({
  Seo: () => null,
}));

describe("framework pages", () => {
  it("renders a useful not-found page", () => {
    render(<FourOhFour />);

    expect(screen.getByRole("heading", { name: "404 — page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to album list" })).toHaveAttribute("href", "/");
    expect(screen.getByText("🔥")).toHaveAttribute("aria-hidden", "true");
  });
});
