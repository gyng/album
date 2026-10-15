/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalNav } from "./GlobalNav";
import { AppLink } from "./platform";

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
  it("groups the games under Fun and identifies the active game", () => {
    render(<GlobalNav currentPage="guess" />);
    expect(screen.getByRole("link", { name: "Fun!" })).toHaveAttribute("href", "/fun");
    expect(screen.getByRole("link", { name: "Fun!" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("navigation", { name: "Fun games" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Guess Where" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("provides the default random slideshow action", () => {
    render(<GlobalNav currentPage="slideshow" />);

    expect(
      screen.getByRole("link", { name: "Start a similar-photo slideshow from a random photo" }),
    ).toHaveAttribute("href", "/slideshow/shell?mode=similar&random=1");
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
            <AppLink href="/album/example">Current album</AppLink>
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

it("groups timeline and trips under Explore with a current subpage", () => {
  render(<GlobalNav currentPage="timeline" />);
  expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("navigation", { name: "Explore views" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("aria-current", "page");
});

it("places the dedicated Wander view after Trips in Explore navigation", () => {
  render(<GlobalNav currentPage="explore-wander" />);
  const links = screen.getAllByRole("link");
  const trips = links.findIndex((link) => link.getAttribute("href") === "/explore/trips");
  expect(links[trips + 1]).toHaveAttribute("href", "/explore/wander");
  expect(links[trips + 1]).toHaveAttribute("aria-current", "page");
});
