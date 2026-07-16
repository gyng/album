/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => <nav /> }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));

import DesignPage from "../../screens/design/DesignScreen";

describe("design catalogue", () => {
  it("renders the shared primitives and keeps interactive examples live", () => {
    render(<DesignPage />);

    expect(screen.getByRole("heading", { name: "Design" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Jump to section" })).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Search photos...");
    fireEvent.change(input, { target: { value: "night market" } });
    expect(input).toHaveValue("night market");

    fireEvent.click(screen.getByRole("radio", { name: "Least similar" }));
    expect(screen.getByRole("radio", { name: "Least similar" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(".stackPage (64px)")).toBeInTheDocument();
  });
});
