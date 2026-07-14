/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { YearSplitHistogram } from "./YearSplitHistogram";

describe("YearSplitHistogram", () => {
  const data = [
    {
      label: "2023",
      data: [
        { label: "Jan", count: 2 },
        { label: "Feb", count: 0 },
      ],
    },
    {
      label: "2024",
      data: [
        { label: "Jan", count: 8 },
        { label: "Feb", count: 1 },
      ],
    },
  ];

  it("orders newest years first and scales linked populated cells", () => {
    const getHref = jest.fn((year: string) =>
      year === "2024" ? `/search?facet=year%3A${year}` : null,
    );
    const { container } = render(
      <YearSplitHistogram title="Recent archive" data={data} getHref={getHref} />,
    );

    expect(screen.getByRole("heading", { name: "Recent archive" })).toBeInTheDocument();
    expect(getHref.mock.calls).toEqual([["2024"], ["2023"]]);
    const yearLabels = container.querySelectorAll(".yearLabel");
    expect(Array.from(yearLabels, (node) => node.textContent)).toEqual(["2024", "2023"]);
    expect(screen.getByRole("link", { name: "2024" })).toHaveAttribute(
      "href",
      "/search?facet=year%3A2024",
    );
    const january = screen.getByRole("link", { name: "2024 Jan · 8 photos" });
    expect(january).toHaveStyle({ "--intensity": "1" });
    expect(screen.getByLabelText("2024 Feb · 1 photos")).toHaveStyle({
      "--intensity": "0.125",
    });
    expect(screen.getByLabelText("2023 Feb · 0 photos")).not.toHaveAttribute("href");
  });

  it("renders unlinked cells when no navigation builder is supplied", () => {
    render(<YearSplitHistogram title="Archive" data={data.slice(0, 1)} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByLabelText("2023 Jan · 2 photos")).toBeInTheDocument();
  });

  it("renders an empty matrix without inventing month labels", () => {
    const { container } = render(<YearSplitHistogram title="No years" data={[]} />);
    expect(screen.getByRole("heading", { name: "No years" })).toBeInTheDocument();
    expect(container.querySelectorAll(".monthLabel")).toHaveLength(0);
  });
});
