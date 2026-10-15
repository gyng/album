/** @jest-environment jsdom */
import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CloudSpotlight } from "./CloudSpotlight";
import { encodeSearchText } from "./search/textEmbeddings";
jest.mock("./database/useDatabase", () => {
  const database = {};
  return {
    useDatabase: () => [database, 0, null, null],
    useEmbeddingsDatabase: () => [database, 0, null, null],
  };
});
jest.mock("./search/textEmbeddings", () => ({ encodeSearchText: jest.fn() }));
jest.mock("./search/api", () => ({
  fetchSemanticPaths: async () => ["photo"],
}));
const Harness = () => {
  const [paths, setPaths] = useState<string[] | null>(null);
  return (
    <>
      <CloudSpotlight onMatches={setPaths} />
      <p aria-label="Matches">{paths?.join(",") ?? "all"}</p>
    </>
  );
};
it("loads scene search on submission and returns ranked paths", async () => {
  jest.mocked(encodeSearchText).mockResolvedValue([1, 0]);
  render(<Harness />);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rain" } });
  fireEvent.click(screen.getByRole("button", { name: "Spotlight" }));
  await waitFor(() => expect(screen.getByLabelText("Matches")).toHaveTextContent("photo"));
  expect(screen.getByRole("button", { name: "Spotlight" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByLabelText("Matches")).toHaveTextContent("all");
});
it("does not restore a cleared query when its model finishes loading", async () => {
  let finish: (value: number[]) => void = () => {};
  jest.mocked(encodeSearchText).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rain" } });
  fireEvent.click(screen.getByRole("button", { name: "Spotlight" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true"));
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await act(async () => finish([1, 0]));
  expect(screen.getByLabelText("Matches")).toHaveTextContent("all");
  expect(screen.queryByRole("status")).toBeNull();
});

it("clears unsubmitted text without starting scene search", () => {
  render(<Harness />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rain" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(screen.queryByRole("status")).toBeNull();
});
