/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ExploreFramingFacet } from "./ExploreFramingFacet";

it("reveals and hides uncommon aspect ratios without changing the common rows", () => {
  render(
    <ExploreFramingFacet
      facet={{
        facetId: "aspect-ratio",
        displayName: "Aspect ratio",
        coverage: 1,
        data: ["3:2", "2:3", "4:3", "3:4", "1:1", "16:9", "9:16"].map((label, index) => ({
          label,
          count: 20 - index,
        })),
      }}
    />,
  );
  expect(screen.queryByText("16:9")).toBeNull();
  const more = screen.getByRole("button", { name: "More (2)" });
  expect(more).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(more);
  expect(screen.getByText("16:9")).toBeTruthy();
  expect(screen.getByText("3:2")).toBeTruthy();
  const less = screen.getByRole("button", { name: "Less" });
  expect(less).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(less);
  expect(screen.queryByText("16:9")).toBeNull();
});
