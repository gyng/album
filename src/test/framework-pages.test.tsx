/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import FourOhFour from "../pages/404";
import RobotsTxt, { getServerSideProps } from "../pages/robots.txt";

jest.mock("../components/GlobalNav", () => ({
  GlobalNav: () => <nav aria-label="Global navigation" />,
}));

jest.mock("../components/Seo", () => ({
  Seo: () => null,
}));

describe("framework pages", () => {
  it("renders a useful not-found page", () => {
    render(<FourOhFour />);

    expect(screen.getByRole("heading", { name: "404 — page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to album list" })).toHaveAttribute("href", "/");
    expect(screen.getByText("🔥")).toHaveAttribute("aria-hidden", "true");
  });

  it("serves robots.txt as a plain-text response", async () => {
    const res = {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    await expect(getServerSideProps({ res } as never)).resolves.toEqual({ props: {} });
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining("User-agent: *"));
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("has no rendered page body because the response is written by the server", () => {
    const { container } = render(<RobotsTxt />);

    expect(container).toBeEmptyDOMElement();
  });
});
