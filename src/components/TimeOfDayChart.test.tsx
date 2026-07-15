/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { TimeOfDayChart } from "./TimeOfDayChart";

const hours = (counts: number[]) =>
  counts.map((count, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    count,
  }));

describe("TimeOfDayChart", () => {
  it("renders an empty-data summary and accessible zero-value columns", () => {
    render(<TimeOfDayChart data={hours([0, 0])} />);

    expect(screen.getByText("No time-of-day data yet.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "00:00 · 0 photos" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "01:00 · 0 photos" })).toBeTruthy();
    expect(screen.getByText("Night")).toBeTruthy();
    expect(screen.getByText("Evening")).toBeTruthy();
  });

  it("summarises a contiguous peak window", () => {
    render(<TimeOfDayChart data={hours([1, 7, 7, 2])} />);

    expect(screen.getByText("Peak window: 01:00-02:00")).toBeTruthy();
  });

  it("uses the first peak when equal maxima are not contiguous", () => {
    render(<TimeOfDayChart data={hours([1, 8, 2, 8])} />);

    expect(screen.getByText("Peak hour: 01:00")).toBeTruthy();
  });

  it("activates columns on hover and unregisters their nodes on unmount", () => {
    const onActivate = jest.fn();
    const onDeactivate = jest.fn();
    const registerColumn = jest.fn();
    const { unmount } = render(
      <TimeOfDayChart
        data={hours([1, 10])}
        activeLabel="01:00"
        onActivate={onActivate}
        onDeactivate={onDeactivate}
        registerColumn={registerColumn}
      />,
    );
    const peak = screen.getByRole("img", { name: "01:00 · 10 photos" });

    fireEvent.mouseEnter(peak);
    fireEvent.mouseLeave(peak);

    expect(onActivate).toHaveBeenCalledWith("01:00");
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(registerColumn).toHaveBeenCalledWith("01:00", peak);

    unmount();
    expect(registerColumn).toHaveBeenCalledWith("01:00", null);
  });

  it("keeps a small non-zero bar visible without requiring callbacks", () => {
    const { container } = render(<TimeOfDayChart data={hours([100, 1])} />);

    fireEvent.mouseEnter(screen.getByRole("img", { name: "01:00 · 1 photos" }));
    fireEvent.mouseLeave(screen.getByRole("img", { name: "01:00 · 1 photos" }));

    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect((bars[1] as HTMLElement).style.blockSize).toBe("4%");
  });
});
