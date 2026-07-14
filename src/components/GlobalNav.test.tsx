/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { GlobalNav } from "./GlobalNav";

jest.mock("./Nav", () => ({
  Nav: ({
    extraItems,
    hasPadding,
    isHome,
  }: {
    extraItems: React.ReactNode;
    hasPadding?: boolean;
    isHome?: boolean;
  }) => (
    <nav data-padding={String(hasPadding)} data-home={String(isHome)}>
      <ul>{extraItems}</ul>
    </nav>
  ),
}));

describe("GlobalNav", () => {
  it("provides the default random slideshow action", () => {
    render(<GlobalNav currentPage="slideshow" />);

    expect(
      screen.getByRole("link", { name: "Start a similar-photo slideshow from a random photo" }),
    ).toHaveAttribute("href", "/slideshow?mode=similar&random=1");
    expect(screen.getByRole("link", { name: "Map" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Slideshow" })).toHaveAttribute("aria-current", "page");
  });

  it("marks the current page and supports page-specific navigation actions", () => {
    const onMapClick = jest.fn();
    render(
      <GlobalNav
        currentPage="map"
        hasPadding={false}
        onMapClick={onMapClick}
        slideshowAction={<button type="button">Start filtered slideshow</button>}
        extraItems={
          <li>
            <Link href="/album/example">Current album</Link>
          </li>
        }
      />,
    );

    const mapLink = screen.getByRole("link", { name: "Map" });
    expect(mapLink).toHaveAttribute("aria-current", "page");
    fireEvent.click(mapLink);
    expect(onMapClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Start filtered slideshow" })).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Start a similar-photo slideshow from a random photo" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Current album" })).toHaveAttribute(
      "href",
      "/album/example",
    );
  });
});
