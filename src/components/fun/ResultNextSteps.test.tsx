/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ResultNextSteps } from "./ResultNextSteps";

const located = (name: string) => ({
  path: `../albums/test-simple/${name}`,
  location: { lat: 1, lng: 2 },
});

it("links to search for photographs like the chosen one", () => {
  render(
    <ResultNextSteps
      photos={[located("a b.jpg"), located("c.jpg")]}
      similarTo="../albums/test-simple/c.jpg"
    />,
  );
  expect(screen.getByRole("link", { name: "Similar photographs" })).toHaveAttribute(
    "href",
    `/search?similar=${encodeURIComponent("../albums/test-simple/c.jpg")}`,
  );
});

it("defaults the similar search to the first photograph", () => {
  render(<ResultNextSteps photos={[{ path: "../albums/test-simple/ü 1.jpg" }]} />);
  const href = screen.getByRole("link", { name: "Similar photographs" }).getAttribute("href")!;
  expect(new URL(href, "https://example.org").searchParams.get("similar")).toBe(
    "../albums/test-simple/ü 1.jpg",
  );
});

it("deals the located photographs, in order, as a Guess Where game", () => {
  render(
    <ResultNextSteps
      photos={[
        located("one.jpg"),
        { path: "../albums/test-simple/nowhere.jpg" },
        located("two.jpg"),
      ]}
    />,
  );
  const href = screen
    .getByRole("link", { name: "Guess where these were taken" })
    .getAttribute("href")!;
  const url = new URL(href, "https://example.org");
  expect(url.pathname).toBe("/fun/guess");
  expect(url.searchParams.getAll("photos")).toEqual([
    "../albums/test-simple/one.jpg",
    "../albums/test-simple/two.jpg",
  ]);
});

it("offers no Guess Where game for fewer than two located photographs", () => {
  render(
    <ResultNextSteps photos={[located("one.jpg"), { path: "../albums/test-simple/two.jpg" }]} />,
  );
  expect(screen.queryByRole("link", { name: "Guess where these were taken" })).toBeNull();
  expect(screen.getByRole("link", { name: "Similar photographs" })).toBeInTheDocument();
});

it("renders nothing without photographs", () => {
  const { container } = render(<ResultNextSteps photos={[]} />);
  expect(container).toBeEmptyDOMElement();
});
