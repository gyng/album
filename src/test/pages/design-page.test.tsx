/**
 * @jest-environment jsdom
 */

import { render, screen, within } from "@testing-library/react";

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => <nav /> }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));

import DesignPage from "../../screens/design/DesignScreen";

describe("design catalogue", () => {
  it("links every catalogue entry to a rendered section", () => {
    render(<DesignPage />);

    expect(screen.getByRole("heading", { name: "Design" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Jump to section" });
    const links = within(navigation).getAllByRole("link");

    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      const destination = link.getAttribute("href");
      expect(destination).toMatch(/^#[a-z-]+$/);
      expect(document.querySelector(destination!)).toBeInTheDocument();
    });
  });
});
