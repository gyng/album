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
    expect(
      container.querySelector<HTMLElement>("[data-progress-fill]")?.style.width,
    ).toBe("100%");
  });
});
