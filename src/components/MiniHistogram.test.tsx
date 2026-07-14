/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { MiniHistogram } from "./MiniHistogram";

describe("MiniHistogram", () => {
  it("scales relative counts while keeping small non-empty bars visible", () => {
    render(
      <MiniHistogram
        title="Focal lengths"
        data={[
          { label: "Wide", count: 100 },
          { label: "Normal", count: 1 },
          { label: "Tele", count: 0 },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Focal lengths" })).toBeInTheDocument();
    const wide = screen.getByRole("img", { name: "Wide · 100 photos" });
    const normal = screen.getByRole("img", { name: "Normal · 1 photos" });
    const tele = screen.getByRole("img", { name: "Tele · 0 photos" });
    expect(wide.querySelector("[aria-hidden='true']")).toHaveStyle({ height: "100%" });
    expect(normal.querySelector("[aria-hidden='true']")).toHaveStyle({ height: "4%" });
    expect(tele.querySelector("[aria-hidden='true']")).toHaveStyle({ height: "0%" });
  });

  it("renders an empty chart without inventing buckets", () => {
    const { container } = render(<MiniHistogram title="No readings" data={[]} />);

    expect(screen.getByRole("heading", { name: "No readings" })).toBeInTheDocument();
    expect(container.querySelectorAll("[role='img']")).toHaveLength(0);
  });
});
