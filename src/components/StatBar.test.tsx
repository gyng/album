/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { StatBar } from "./StatBar";

describe("StatBar", () => {
  it("renders a proportional coloured bar and an accessible action", () => {
    const { container } = render(
      <StatBar
        label="Japan"
        labelPrefix={<span aria-hidden="true">🇯🇵</span>}
        count={5000}
        maxCount={10000}
        barColor="rgb(12, 34, 56)"
        actionHref="/search?facet=location%3AJapan"
        actionLabel="View photos from Japan"
      />,
    );

    expect(screen.getByText("5,000")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View photos from Japan" })).toHaveAttribute(
      "href",
      "/search?facet=location%3AJapan",
    );
    const bar = container.querySelector<HTMLElement>("[style]");
    expect(bar?.style.width).toBe("50%");
    expect(bar?.style.backgroundColor).toBe("rgb(12, 34, 56)");
  });

  it("handles a zero maximum and incomplete action configuration", () => {
    const { container, rerender } = render(
      <StatBar label="Unknown" count={0} maxCount={0} actionHref="/search" />,
    );

    expect(container.querySelector<HTMLElement>("[style]")?.style.width).toBe("0%");
    expect(screen.queryByRole("link")).toBeNull();

    rerender(<StatBar label="No action" count={1} maxCount={2} actionLabel="Missing URL" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
