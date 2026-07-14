/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchRefinementSection } from "./SearchRefinementSection";

describe("SearchRefinementSection", () => {
  it("shows active, available, exhausted, and uncounted refinements", () => {
    const onToggleTag = jest.fn();
    render(
      <SearchRefinementSection
        databaseProgressDetails={{ loaded: 512, total: 1024 }}
        normalizedSearchTerms={["active"]}
        normalizedTags={[
          { name: "active", count: 5 },
          { name: "available", count: 9 },
          { name: "exhausted", count: 4 },
          { name: "unknown", count: 7 },
        ]}
        progress={50}
        refinementCounts={{ available: 3, exhausted: 0 }}
        onToggleTag={onToggleTag}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    const active = screen.getByRole("button", { name: "active 4" });
    const available = screen.getByRole("button", { name: "available 3" });
    const exhausted = screen.getByRole("button", { name: "exhausted 0" });
    const unknown = screen.getByRole("button", { name: "unknown 6" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(available).toBeEnabled();
    expect(exhausted).toBeDisabled();
    expect(unknown).toBeEnabled();

    fireEvent.click(active);
    fireEvent.click(available);
    fireEvent.click(unknown);
    expect(onToggleTag.mock.calls).toEqual([
      ["active", true],
      ["available", false],
      ["unknown", false],
    ]);
  });

  it("renders an empty refinement list after loading completes", () => {
    render(
      <SearchRefinementSection
        normalizedSearchTerms={[]}
        normalizedTags={[]}
        progress={100}
        refinementCounts={{}}
        onToggleTag={jest.fn()}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/keep stacking keywords/)).toBeInTheDocument();
  });
});
