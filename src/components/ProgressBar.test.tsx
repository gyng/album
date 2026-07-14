/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("exposes its value and download label to assistive technology", () => {
    render(
      <ProgressBar
        progress={35}
        details={{ loaded: 1024, total: 4096 }}
        activity="Downloading search index"
      />,
    );

    const progressbar = screen.getByRole("progressbar", {
      name: "Downloading search index… 1.0 KB / 4.0 KB",
    });
    expect(progressbar.getAttribute("aria-valuemin")).toBe("0");
    expect(progressbar.getAttribute("aria-valuemax")).toBe("100");
    expect(progressbar.getAttribute("aria-valuenow")).toBe("35");
    expect(progressbar.getAttribute("aria-valuetext")).toBe(
      "Downloading search index… 1.0 KB / 4.0 KB",
    );
  });

  it("clamps out-of-range values for both presentation and semantics", () => {
    const { container } = render(
      <ProgressBar progress={140} hideIfComplete={false} label="Finishing" />,
    );

    const progressbar = screen.getByRole("progressbar", { name: "Finishing" });
    expect(progressbar.getAttribute("aria-valuenow")).toBe("100");
    expect(container.querySelector<HTMLElement>("[data-progress-fill]")?.style.width).toBe("100%");
  });

  it("uses safe byte labels for missing and invalid progress details", () => {
    const { rerender } = render(<ProgressBar progress={-20} />);

    expect(screen.getByRole("progressbar", { name: "Loading…" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    rerender(<ProgressBar progress={10} details={{ loaded: -1, total: 500 }} />);
    expect(screen.getByRole("progressbar", { name: "Loading… 0 B / 500 B" })).toBeTruthy();

    rerender(<ProgressBar progress={20} details={{ loaded: 50, total: 0 }} />);
    expect(screen.getByRole("progressbar", { name: "Loading…" })).toBeTruthy();
  });

  it("hides a completed bar by default", () => {
    const { container } = render(<ProgressBar progress={100} />);

    expect(container).toBeEmptyDOMElement();
  });
});
