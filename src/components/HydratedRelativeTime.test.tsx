/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { HydratedRelativeTime } from "./HydratedRelativeTime";

describe("HydratedRelativeTime", () => {
  it("omits clock-dependent text from server HTML", () => {
    expect(renderToString(<HydratedRelativeTime date={new Date("2020-01-01T12:00:00Z")} />)).toBe(
      "",
    );
  });

  it("renders relative text after mounting in the browser", () => {
    jest.useFakeTimers().setSystemTime(new Date("2020-01-02T12:00:00Z"));
    try {
      render(<HydratedRelativeTime date={new Date("2020-01-01T12:00:00Z")} />);
      expect(screen.getByText("yesterday")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
